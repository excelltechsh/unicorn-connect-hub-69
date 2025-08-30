import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      throw new Error('URL is required');
    }

    console.log('Discovering pages for URL:', url);

    // Use Firecrawl's map endpoint to discover pages without crawling content
    const mapResponse = await fetch('https://api.firecrawl.dev/v1/map', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        search: '',
        ignoreSitemap: false,
        includeSubdomains: false,
        limit: 50
      })
    });

    if (!mapResponse.ok) {
      throw new Error(`Firecrawl API error: ${mapResponse.status}`);
    }

    const mapData = await mapResponse.json();
    console.log('Firecrawl map response:', mapData);

    if (!mapData.success) {
      throw new Error(`Page discovery failed: ${mapData.error}`);
    }

    // Transform the response to include page metadata
    const pages = mapData.links?.map((link: string) => ({
      url: link,
      title: extractTitleFromUrl(link),
      description: `Page found at ${link}`
    })) || [];

    return new Response(JSON.stringify({ 
      success: true, 
      pages: pages,
      total: pages.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in discover-pages:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function extractTitleFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Remove leading slash and file extensions
    const cleanPath = pathname.replace(/^\//, '').replace(/\.[^/.]+$/, '');
    
    if (!cleanPath) return 'Home Page';
    
    // Convert dashes/underscores to spaces and capitalize words
    return cleanPath
      .split('/')
      .pop() // Get the last segment
      ?.split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || 'Unknown Page';
  } catch {
    return 'Unknown Page';
  }
}