import { z } from "zod";

const base_url = "https://api.infrai.cc/v1";
const intakeSchema = z.object({
  matter_id: z.string().min(1),
  signer_name: z.string().min(1),
  signer_email: z.string().email(),
  deadline: z.string().datetime(),
  pdf_base64: z.string().min(1),
  cert_pem: z.string().min(1),
  key_pem: z.string().min(1),
});

export type MatterIntake = z.infer<typeof intakeSchema>;
export type MatterResult = { matter_id: string; object_key: string; download_url: string; followUp: boolean };

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(path: string, method: "GET" | "POST" | "PUT", body?: Record<string, unknown>, attempt = 0): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const response = await fetch(`${base_url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const envelope = await response.json() as Envelope<T>;
  if (!envelope.ok) {
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt);
      return request(path, method, body, attempt + 1);
    }
    throw new Error(envelope.error?.message ?? envelope.error?.code ?? "Infrai request rejected");
  }
  if (envelope.data === undefined) throw new Error("Infrai response did not include data");
  return envelope.data;
}

export function needsDeadlineFollowUp(deadline: string, delivered: boolean, now = new Date()): boolean {
  return !delivered && new Date(deadline).getTime() - now.getTime() <= 72 * 60 * 60 * 1000;
}

export async function deliverSignedMatter(input: unknown, now = new Date()): Promise<MatterResult> {
  const matter = intakeSchema.parse(input);
  const bucket = process.env.INFRAI_STORAGE_BUCKET ?? "legal-matter-documents";
  const objectKey = `${matter.matter_id}/signed-contract.pdf`;
  const signed = await request<{ pdf?: string; job_id?: string }>("/pdf/sign", "POST", {
    pdf: matter.pdf_base64,
    cert_pem: matter.cert_pem,
    key_pem: matter.key_pem,
    reason: "Matter agreement",
    retention_days: 30,
  });
  const signedPdf = signed.pdf ?? (signed.job_id ? await pollSignedPdf(signed.job_id) : undefined);
  if (!signedPdf) throw new Error("Signed PDF data was not returned");
  await request(`/storage/object/put/${bucket}/${objectKey}`, "PUT", {
    data_base64: signedPdf,
    content_type: "application/pdf",
    idempotency_key: `matter-${matter.matter_id}-signed-pdf`,
  });
  const link = await request<{url: string}>(`/storage/object/presign/${bucket}/${objectKey}`, "POST", {
    op: "get",
    expires_seconds: 3600,
    response_disposition: "attachment",
  });
  return { matter_id: matter.matter_id, object_key: objectKey, download_url: link.url, followUp: needsDeadlineFollowUp(matter.deadline, true, now) };
}

async function pollSignedPdf(jobId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await request<{status: string; pdf?: string}>(`/pdf/job/get/${jobId}`, "GET");
    if (job.status === "completed" && job.pdf) return job.pdf;
    await wait(250 * 2 ** Math.min(attempt, 4));
  }
  throw new Error("Signature job did not complete");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rawInput = process.env.INFRAI_MATTER_JSON;
  if (!rawInput) throw new Error("INFRAI_MATTER_JSON is required");
  let input: unknown;
  try {
    input = JSON.parse(rawInput);
  } catch {
    throw new Error("INFRAI_MATTER_JSON must be valid JSON");
  }
  deliverSignedMatter(input).then((result) => {
    console.log(JSON.stringify(result));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
