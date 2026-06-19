// Cloudflare Pages Function: serves the whole /api/* surface on the same domain
// as the static frontend (kru-fit.pages.dev/api/...). It reuses the exact same
// handler as the standalone Worker so there is one source of truth.
import worker from "../../worker/src/index";

export const onRequest = (context: { request: Request; env: any }) => {
  return worker.fetch(context.request, context.env);
};
