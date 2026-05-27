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

    // Step 1: Login to kkdmx.com (new-api uses /api/user/login)
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
    
    // new-api returns HTTP 200 even on failure, check success field
    if (!loginData.success) {
      return NextResponse.json(
        { error: 'Login failed', message: loginData.message, data: loginData },
        { status: 500 }
      );
    }

    // Extract session cookie for authenticated requests
    const setCookieHeader = loginResponse.headers.get('set-cookie') || '';
    const cookies = setCookieHeader.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
    
    // Also try to extract token from login response
    const token = loginData.data?.token || loginData.data?.access_token || loginData.token;

    // Step 2: Fetch channel data (use cookie auth + token auth)
    const fetchHeaders = {
      'Content-Type': 'application/json',
    };
    if (cookies) {
      fetchHeaders['Cookie'] = cookies;
    }
    if (token) {
      fetchHeaders['Authorization'] = `Bearer ${token}`;
    }

    const channelResponse = await fetch(
      'https://api.kkdmx.com/api/channel/?p=1&page_size=100&id_sort=false&tag_mode=false',
      {
        method: 'GET',
        headers: fetchHeaders,
      }
    );

    if (!channelResponse.ok) {
      return NextResponse.json(
        { error: 'Channel fetch failed', status: channelResponse.status },
        { status: 500 }
      );
    }

    const channelData = await channelResponse.json();
    
    // Extract the data array from response
    const channels = channelData.data || channelData.results || channelData;
    
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

    // Step 5: Clean up data older than 48 hours
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
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
