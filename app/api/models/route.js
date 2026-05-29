import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * API endpoint: returns model testing data from the last 7 days,
 * grouped by model name with 2-day and 5-day availability rates.
 */
export async function GET() {
  try {
    const now = Date.now();
    const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff5d = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const cutoff2d = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all records using pagination (Supabase limits to 1000 rows per request)
    const PAGE_SIZE = 1000;
    let allData = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: page, error } = await getSupabaseAdmin()
        .from('model_testing')
        .select('id, name, response_time, create_time')
        .gte('create_time', cutoff7d)
        .order('create_time', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        return NextResponse.json(
          { error: 'Query failed', details: error.message },
          { status: 500 }
        );
      }

      allData = allData.concat(page);
      
      if (page.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }

    const data = allData;

    // Group by model name and calculate availability rates
    const grouped = {};
    data.forEach(record => {
      if (!grouped[record.name]) {
        grouped[record.name] = { records: [], stats2d: { total: 0, nonRed: 0 }, stats5d: { total: 0, nonRed: 0 } };
      }
      const entry = grouped[record.name];
      entry.records.push({
        id: record.id,
        response_time: record.response_time,
        create_time: record.create_time,
      });

      const isRed = record.response_time / 1000 >= 30;

      // 5-day availability (all records within 5 days)
      if (record.create_time >= cutoff5d) {
        entry.stats5d.total++;
        if (!isRed) entry.stats5d.nonRed++;
      }

      // 2-day availability (all records within 2 days)
      if (record.create_time >= cutoff2d) {
        entry.stats2d.total++;
        if (!isRed) entry.stats2d.nonRed++;
      }
    });

    // Convert to array format with availability rates, sorted by 5-day availability (desc)
    const result = Object.entries(grouped)
      .map(([name, { records, stats2d, stats5d }]) => ({
        name,
        records,
        avail_2d: stats2d.total > 0 ? Math.round((stats2d.nonRed / stats2d.total) * 10000) / 100 : null,
        avail_5d: stats5d.total > 0 ? Math.round((stats5d.nonRed / stats5d.total) * 10000) / 100 : null,
      }))
      .sort((a, b) => (b.avail_5d ?? -1) - (a.avail_5d ?? -1));

    return NextResponse.json({
      success: true,
      data: result,
      total_models: result.length,
      total_records: data.length,
      query_from: cutoff7d,
    });
  } catch (error) {
    console.error('Models API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}
