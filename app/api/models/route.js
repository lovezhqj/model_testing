import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * API endpoint: returns model testing data from the last 24 hours,
 * grouped by model name and sorted by create_time.
 */
export async function GET() {
  try {
    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await getSupabaseAdmin()
      .from('model_testing')
      .select('id, name, response_time, create_time')
      .gte('create_time', cutoffTime)
      .order('create_time', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Query failed', details: error.message },
        { status: 500 }
      );
    }

    // Group by model name
    const grouped = {};
    data.forEach(record => {
      if (!grouped[record.name]) {
        grouped[record.name] = [];
      }
      grouped[record.name].push({
        id: record.id,
        response_time: record.response_time,
        create_time: record.create_time,
      });
    });

    // Convert to array format sorted by model name
    const result = Object.entries(grouped)
      .map(([name, records]) => ({
        name,
        records,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      success: true,
      data: result,
      total_models: result.length,
      total_records: data.length,
      query_from: cutoffTime,
    });
  } catch (error) {
    console.error('Models API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
