import "./lib/error-capture";

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

const handler = createStartHandler(defaultStreamHandler);

function errorMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.stack || err.message;
  try { return typeof err === "string" ? err : JSON.stringify(err); }
  catch { return String(err); }
}

async function normalizeCatastrophicSsrResponse(request: Request, response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  const msg = errorMessage(captured) || `h3 swallowed SSR error: ${body}`;
  console.error(captured ?? new Error(msg));

  const isServerFn = new URL(request.url).pathname.startsWith("/_serverFn/");
  if (isServerFn) {
    return new Response(
      JSON.stringify({ error: "ServerFnError", message: msg }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "x-server-error": msg.slice(0, 500),
        },
      },
    );
  }
  return new Response(renderErrorPage(), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-server-error": msg.slice(0, 500),
    },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    void env;
    void ctx;
    try {
      const response = await handler(request);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      const msg = errorMessage(error);
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-server-error": msg.slice(0, 500),
        },
      });
    }
  },
};
