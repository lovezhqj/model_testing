import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

const TARGET_HOST = 'https://api.kkdmx.com';

async function handle(request, context) {
  try {
    const params = await context.params;
    const pathSegments = params?.path || [];
    const urlPath = pathSegments.join('/');
    const searchParams = new URL(request.url).search;
    const targetUrl = `${TARGET_HOST}/${urlPath}${searchParams}`;

    console.log(`[Proxy] Routing ${request.method} request to: ${targetUrl}`);

    // Prepare headers
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // Don't forward host and some other headers to prevent conflict, and strip accept-encoding
      // so the upstream server returns plain data instead of compressed.
      if (!['host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-encoding'].includes(lowerKey)) {
        headers.set(key, value);
      }
    });
    headers.set('Host', 'api.kkdmx.com');
    headers.set('Origin', TARGET_HOST);
    
    // If referer is our own site, rewrite it to target host
    const referer = request.headers.get('referer');
    if (referer) {
      try {
        const refUrl = new URL(referer);
        headers.set('Referer', `${TARGET_HOST}${refUrl.pathname}${refUrl.search}`);
      } catch (e) {
        headers.delete('referer');
      }
    }

    // Read body
    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
      body = await request.arrayBuffer();
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: 'manual', // handle redirect manually to rewrite Location headers
    });

    // Prepare response headers
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      
      // Strip encoding, length, CSP and frame headers to prevent browser blocks or decoding errors.
      // Since fetch decompresses the response automatically, forwarding content-encoding/length
      // causes browsers to fail with content decoding errors or truncate the response.
      if ([
        'content-encoding', 
        'content-length', 
        'content-security-policy', 
        'x-frame-options', 
        'frame-options', 
        'transfer-encoding'
      ].includes(lowerKey)) {
        return;
      }

      if (lowerKey === 'location') {
        // Rewrite location header so browser stays in proxy domain
        let locationUrl = value;
        if (locationUrl.startsWith(TARGET_HOST)) {
          locationUrl = locationUrl.replace(TARGET_HOST, '/api/proxy');
        } else if (locationUrl.startsWith('/')) {
          locationUrl = `/api/proxy${locationUrl}`;
        }
        responseHeaders.set('Location', locationUrl);
      } else {
        responseHeaders.set(key, value);
      }
    });

    // Intercept login response
    const isLoginEndpoint = urlPath === 'api/user/login' && request.method === 'POST';
    
    if (isLoginEndpoint) {
      const clone = response.clone();
      try {
        const json = await clone.json();
        console.log('[Proxy] Intercepted login response:', JSON.stringify(json));
        if (json.success) {
          // Extract cookies from response headers
          let cookies = '';
          if (response.headers.getSetCookie) {
            const setCookieArr = response.headers.getSetCookie();
            cookies = setCookieArr.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
          }
          if (!cookies) {
            const rawSetCookie = response.headers.get('set-cookie') || '';
            if (rawSetCookie) {
              cookies = rawSetCookie.split(';')[0].trim();
            }
          }

          const userId = json.data?.id || 1;
          const token = json.data?.token || '';

          console.log('[Proxy] Intercepted credentials:', { userId, token: token ? 'FOUND' : 'EMPTY', cookies: cookies ? 'FOUND' : 'EMPTY' });

          // Save to Supabase auth_config
          const supabase = getSupabaseAdmin();
          
          const upsertData = [
            { key: 'cookies', value: cookies, updated_at: new Date().toISOString() },
            { key: 'user_id', value: String(userId), updated_at: new Date().toISOString() },
            { key: 'token', value: token, updated_at: new Date().toISOString() },
          ];

          const { error } = await supabase.from('auth_config').upsert(upsertData, { onConflict: 'key' });
          if (error) {
            console.error('[Proxy] Failed to save credentials to Supabase:', error.message);
          } else {
            console.log('[Proxy] Successfully saved credentials to Supabase.');
          }
        }
      } catch (err) {
        console.error('[Proxy] Error parsing login response:', err);
      }
    }

    // Return the response
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const htmlText = await response.text();
      return new Response(htmlText, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // Convert response body to ArrayBuffer before returning
    // This is safer and more robust in Serverless environments than forwarding response.body stream directly.
    const arrayBuffer = await response.arrayBuffer();
    return new Response(arrayBuffer, {
      status: response.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('[Proxy] Request failed:', error);
    return NextResponse.json({ error: 'Proxy Request Failed', details: error.message }, { status: 500 });
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
