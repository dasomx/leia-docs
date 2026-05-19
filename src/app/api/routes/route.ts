import { source } from '@/lib/source';
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    routes: source.getPages().map(p => p.url)
  });
}
