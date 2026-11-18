export const ALLOWED_METHODS = "GET, HEAD, POST, PUT, DELETE, OPTIONS"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": ALLOWED_METHODS,
  "Access-Control-Max-Age": "86400",
}

export function handleOptions(request) {
  let headers = request.headers;
  if (
    headers.get("Origin") !== null &&
    headers.get("Access-Control-Request-Method") !== null
  ){
    let respHeaders = {
      ...corsHeaders,
      Allow: ALLOWED_METHODS,
      ...(request.headers.get("Access-Control-Request-Headers")
        ? { "Access-Control-Allow-Headers": request.headers.get("Access-Control-Request-Headers") }
        : {}),
    }

    return new Response(null, {
      headers: respHeaders,
    })
  }
  else {
    return new Response(null, {
      headers: {
        Allow: ALLOWED_METHODS,
      },
    })
  }
}

export function corsWrapResponse(response) {
  if (response.headers !== undefined)
    response.headers.set("Access-Control-Allow-Origin", "*")
  return response
}
