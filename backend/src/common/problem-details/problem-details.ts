export type ProblemDetailsInput = {
  status: number;
  code: string;
  title: string;
  detail: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
};

function codeToProblemSlug(code: string): string {
  return code.toLowerCase().replaceAll("_", "-");
}

export function createProblemDetails(input: ProblemDetailsInput): ProblemDetails {
  return {
    type: `https://shards.local/problems/${codeToProblemSlug(input.code)}`,
    title: input.title,
    status: input.status,
    code: input.code,
    detail: input.detail,
    requestId: input.requestId,
    ...(input.fieldErrors ? { fieldErrors: input.fieldErrors } : {}),
  };
}
