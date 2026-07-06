import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/auth: return current auth status
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('auth_config')
      .select('key, value, updated_at');

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const configs = {};
    let lastUpdated = null;
    
    data.forEach(item => {
      configs[item.key] = item.value;
      if (item.updated_at) {
        const d = new Date(item.updated_at);
        if (!lastUpdated || d > lastUpdated) {
          lastUpdated = d;
        }
      }
    });

    const hasCookies = !!configs['cookies'];
    const hasToken = !!configs['token'];
    const hasUserId = !!configs['user_id'];
    const authorized = hasCookies && hasUserId;

    return NextResponse.json({
      success: true,
      authorized,
      details: {
        has_cookies: hasCookies,
        has_token: hasToken,
        has_user_id: hasUserId,
        user_id: configs['user_id'] || null,
        token_preview: configs['token'] ? `${configs['token'].substring(0, 8)}...` : null,
      },
      updated_at: lastUpdated ? lastUpdated.toISOString() : null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST /api/auth: Test connection to api.kkdmx.com
export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('auth_config')
      .select('key, value');

    if (error) {
      return NextResponse.json({ success: false, error: 'Database fetch failed: ' + error.message }, { status: 500 });
    }

    const configs = {};
    data.forEach(item => {
      configs[item.key] = item.value;
    });

    const cookies = configs['cookies'];
    const userId = configs['user_id'];

    if (!cookies || !userId) {
      return NextResponse.json({ success: false, error: '未检测到有效授权信息，请先授权登录。' }, { status: 400 });
    }

    // Try fetching channel list
    const testResponse = await fetch(
      'https://api.kkdmx.com/api/channel/?p=1&page_size=1&id_sort=false&tag_mode=false',
      {
        method: 'GET',
        headers: {
          'Cookie': cookies,
          'New-Api-User': String(userId),
          'Content-Type': 'application/json',
        },
      }
    );

    if (!testResponse.ok) {
      const errText = await testResponse.text();
      return NextResponse.json({
        success: false,
        error: `连接测试失败 (HTTP ${testResponse.status}): ${errText.substring(0, 100)}`
      }, { status: 500 });
    }

    const json = await testResponse.json();
    if (!json.success) {
      return NextResponse.json({
        success: false,
        error: `接口返回错误: ${json.message || '未知错误'}`
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      message: '授权连接测试成功！接口通信正常。',
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: '网络错误: ' + error.message }, { status: 500 });
  }
}
