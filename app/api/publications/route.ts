import { write } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = (request: Request) => write(request, "publish");
