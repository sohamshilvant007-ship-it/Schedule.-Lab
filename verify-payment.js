export async function onRequestPost(context) {
  const { request, env } = context;

  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return new Response(JSON.stringify({ error: 'Razorpay credentials not configured on server' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET) using Web Crypto API
  // (Cloudflare Workers runtime doesn't use Node's `crypto` module)
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(`${razorpay_order_id}|${razorpay_payment_id}`)
  );
  const generatedSignature = [...new Uint8Array(signatureBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  if (generatedSignature !== razorpay_signature) {
    // Signature mismatch — do NOT mark as paid
    return new Response(JSON.stringify({ success: false, error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true, payment_id: razorpay_payment_id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
