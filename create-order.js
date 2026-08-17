export async function onRequestPost(context) {
  const { request, env } = context;

  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
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

  const { amount, currency, receipt } = body;

  // Validate amount >= 100 paise (₹1 minimum per Razorpay rules)
  if (!amount || typeof amount !== 'number' || amount < 100) {
    return new Response(JSON.stringify({ error: 'Amount must be at least 100 paise (₹1)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const auth = btoa(`${keyId}:${keySecret}`);
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: Math.round(amount),
        currency: currency || 'INR',
        receipt: receipt || `receipt_${Date.now()}`
      })
    });

    if (!rzpRes.ok) {
      const errData = await rzpRes.json().catch(() => ({}));
      console.error('Razorpay order create failed', errData);
      return new Response(JSON.stringify({ error: 'Failed to create order' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const order = await rzpRes.json();
    return new Response(JSON.stringify({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('Razorpay create order error:', err);
    return new Response(JSON.stringify({ error: 'Failed to create order' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
