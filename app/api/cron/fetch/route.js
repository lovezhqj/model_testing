import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60 seconds for this route

/**
 * Cron job endpoint: fetches model data from kkdmx.com and stores in Supabase.
 * Triggered by Vercel Cron every 30 minutes, or manually via GET request.
 */
export async function GET(request) {
  try {
    // Verify cron secret (skip in development)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      // Also check Vercel's cron verification
      const isVercelCron = request.headers.get('x-vercel-cron');
      if (!isVercelCron) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Step 1: Load authorization credentials from Supabase
    const supabase = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabase
      .from('auth_config')
      .select('key, value');

    let cookies = '';
    let userId = '1';
    let hasDbAuth = false;

    if (!authError && authData && authData.length > 0) {
      const configs = {};
      authData.forEach(item => {
        configs[item.key] = item.value;
      });
      if (configs['cookies'] && configs['user_id']) {
        cookies = configs['cookies'];
        userId = configs['user_id'];
        hasDbAuth = true;
        console.log('[Cron] Loaded credentials from Supabase. User ID:', userId);
      }
    }

    let channelResponse;
    let channelData;
    let fetchSuccessful = false;

    if (hasDbAuth) {
      try {
        console.log('[Cron] Attempting fetch with Supabase credentials...');
        channelResponse = await fetch(
          'https://api.kkdmx.com/api/channel/?p=1&page_size=100&id_sort=false&tag_mode=false',
          {
            method: 'GET',
            headers: {
              'Cookie': cookies,
              'New-Api-User': String(userId),
              'Content-Type': 'application/json',
            },
          }
        );

        if (channelResponse.ok) {
          channelData = await channelResponse.json();
          // Check if New API returned success
          if (channelData && channelData.success !== false) {
            fetchSuccessful = true;
            console.log('[Cron] Fetch successful using Supabase credentials.');
          } else {
            console.warn('[Cron] Supabase credentials returned failure response:', channelData);
          }
        } else {
          console.warn('[Cron] Supabase credentials fetch failed with status:', channelResponse.status);
        }
      } catch (err) {
        console.error('[Cron] Error during initial fetch:', err.message);
      }
    }

    // Fallback: If DB auth is missing or failed, try username/password login
    if (!fetchSuccessful) {
      console.log('[Cron] DB auth failed or missing. Performing account/password fallback login...');
      if (!process.env.KKDMX_USERNAME || !process.env.KKDMX_PASSWORD) {
        return NextResponse.json(
          { error: 'Unauthorized', message: 'No valid credentials in Supabase and no KKDMX_USERNAME/KKDMX_PASSWORD defined.' },
          { status: 401 }
        );
      }

      const loginResponse = await fetch('https://api.kkdmx.com/api/user/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: process.env.KKDMX_USERNAME,
          password: process.env.KKDMX_PASSWORD,
        }),
      });

      const loginData = await loginResponse.json();
      if (!loginData.success) {
        return NextResponse.json(
          { error: 'Fallback login failed', message: loginData.message, data: loginData },
          { status: 500 }
        );
      }

      // Extract cookie
      cookies = '';
      if (loginResponse.headers.getSetCookie) {
        const setCookieArr = loginResponse.headers.getSetCookie();
        cookies = setCookieArr.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
      }
      if (!cookies) {
        const rawSetCookie = loginResponse.headers.get('set-cookie') || '';
        if (rawSetCookie) {
          cookies = rawSetCookie.split(';')[0].trim();
        }
      }

      userId = String(loginData.data?.id || 1);
      const token = loginData.data?.token || '';

      console.log('[Cron] Fallback login successful. Extracted Cookie & User ID:', userId);

      // Save the new credentials back to Supabase
      try {
        const upsertData = [
          { key: 'cookies', value: cookies, updated_at: new Date().toISOString() },
          { key: 'user_id', value: userId, updated_at: new Date().toISOString() },
          { key: 'token', value: token, updated_at: new Date().toISOString() },
        ];
        await supabase.from('auth_config').upsert(upsertData, { onConflict: 'key' });
        console.log('[Cron] Saved updated credentials to Supabase.');
      } catch (dbErr) {
        console.error('[Cron] Failed to save updated credentials to Supabase:', dbErr.message);
      }

      // Try fetching again
      channelResponse = await fetch(
        'https://api.kkdmx.com/api/channel/?p=1&page_size=100&id_sort=false&tag_mode=false',
        {
          method: 'GET',
          headers: {
            'Cookie': cookies,
            'New-Api-User': userId,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[Cron] Fallback channel response status:', channelResponse.status);

      if (!channelResponse.ok) {
        const errBody = await channelResponse.text();
        console.error('[Cron] Fallback channel fetch failed:', channelResponse.status, errBody);
        return NextResponse.json(
          { error: 'Channel fetch failed after fallback login', status: channelResponse.status, body: errBody },
          { status: 500 }
        );
      }

      channelData = await channelResponse.json();
    }

    // Parse channels list
    const channels = channelData.data?.items || channelData.data || channelData;
    
    if (!Array.isArray(channels)) {
      return NextResponse.json(
        { error: 'Unexpected response format', data: channelData },
        { status: 500 }
      );
    }

    // Step 3: Prepare records for insertion
    const now = new Date().toISOString();
    const records = channels
      .filter(ch => ch.name && ch.response_time !== undefined)
      .map(ch => ({
        name: ch.name,
        response_time: ch.response_time,
        create_time: now,
      }));

    if (records.length === 0) {
      return NextResponse.json(
        { message: 'No valid records to insert', raw: channelData },
        { status: 200 }
      );
    }

    // Step 4: Insert into Supabase
    const { data: insertedData, error: insertError } = await getSupabaseAdmin()
      .from('model_testing')
      .insert(records);

    if (insertError) {
      return NextResponse.json(
        { error: 'Insert failed', details: insertError.message },
        { status: 500 }
      );
    }

    // Step 5: Clean up data older than 7 days
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { error: deleteError } = await getSupabaseAdmin()
      .from('model_testing')
      .delete()
      .lt('create_time', cutoffTime);

    if (deleteError) {
      console.error('Cleanup failed:', deleteError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Inserted ${records.length} records, cleaned up data before ${cutoffTime}`,
      count: records.length,
      timestamp: now,
    });
  } catch (error) {
    console.error('Cron fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
