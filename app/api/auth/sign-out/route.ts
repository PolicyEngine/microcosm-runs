import { signOut } from "@/lib/google-sign-in";
export const runtime = "nodejs";
export const POST = (request: Request) => signOut(request);
