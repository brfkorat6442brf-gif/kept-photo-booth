// Cloudflare Pages Function: /api/get_remote_frame
// Returns remote camera status (fallback inactive on cloud edge)

export async function onRequestGet() {
  return new Response(JSON.stringify({
    image: null,
    active: false,
    timestamp: Date.now()
  }), {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
