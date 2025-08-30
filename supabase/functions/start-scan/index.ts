import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header missing');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: user } = await supabase.auth.getUser();
    if (!user.user) {
      throw new Error('User not authenticated');
    }

    const { url, selectedUrls, isSelective } = await req.json();
    
    if (!url) {
      throw new Error('URL is required');
    }

    // Create scan record
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .insert({
        user_id: user.user.id,
        url: url,
        status: 'crawling',
        is_selective: isSelective || false,
        selected_urls: selectedUrls || null
      })
      .select()
      .single();

    if (scanError) {
      console.error('Error creating scan:', scanError);
      throw scanError;
    }

    console.log('Created scan:', scan.id);

    // Start background crawling process
    EdgeRuntime.waitUntil(crawlWebsite(scan.id, url, authHeader, selectedUrls, isSelective));

    return new Response(JSON.stringify({ 
      success: true, 
      scanId: scan.id,
      message: 'Scan started successfully' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in start-scan:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function crawlWebsite(scanId: string, url: string, authHeader: string, selectedUrls?: string[], isSelective?: boolean) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    console.log(`Starting Firecrawl for scan ${scanId}, URL: ${url}`);

    // Determine crawl strategy based on whether this is selective or full crawl
    if (isSelective && selectedUrls && selectedUrls.length > 0) {
      // Selective crawl: scrape only selected URLs
      console.log(`Starting selective crawl for ${selectedUrls.length} URLs`);
      
      for (const pageUrl of selectedUrls) {
        try {
          const scrapeResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: pageUrl,
              formats: ['markdown', 'html', 'links'],
              onlyMainContent: true
            })
          });

          if (scrapeResponse.ok) {
            const scrapeData = await scrapeResponse.json();
            if (scrapeData.success && scrapeData.data) {
              await processPage(scrapeData.data, scanId, supabase, url);
            }
          }
        } catch (error) {
          console.error(`Error scraping ${pageUrl}:`, error);
        }
      }

      // Update scan status to completed
      await supabase
        .from('scans')
        .update({ status: 'completed' })
        .eq('id', scanId);

      console.log(`Selective crawl completed for scan ${scanId}`);
      return;
    }

    // Full site crawl using original logic
    const crawlResponse = await fetch('https://api.firecrawl.dev/v1/crawl', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: url,
        limit: 50,
        scrapeOptions: {
          formats: ['markdown', 'html', 'links'],
          onlyMainContent: true
        }
      })
    });

    if (!crawlResponse.ok) {
      throw new Error(`Firecrawl API error: ${crawlResponse.status}`);
    }

    const crawlData = await crawlResponse.json();
    console.log('Firecrawl response:', crawlData);

    if (!crawlData.success) {
      throw new Error(`Firecrawl failed: ${crawlData.error}`);
    }

    // Check if this is a job ID response (async crawl)
    if (crawlData.id && crawlData.url) {
      console.log(`Got crawl job ID: ${crawlData.id}, polling for completion...`);
      await pollCrawlJob(crawlData.id, scanId, authHeader);
      return;
    }

    // Store crawled pages (for synchronous responses)
    const pages = crawlData.data || [];
    console.log(`Processing ${pages.length} pages`);

    for (const page of pages) {
      await processPage(page, scanId, supabase, url);
    }

    // Update scan status
    await supabase
      .from('scans')
      .update({ status: 'completed' })
      .eq('id', scanId);

    console.log(`Crawl completed for scan ${scanId}`);

  } catch (error) {
    console.error(`Error in crawlWebsite for scan ${scanId}:`, error);
    
    // Update scan with error
    await supabase
      .from('scans')
      .update({ 
        status: 'failed',
        error: error.message 
      })
      .eq('id', scanId);
  }
}

async function pollCrawlJob(jobId: string, scanId: string, authHeader: string) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const maxAttempts = 60; // 5 minutes max (5 second intervals)
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      console.log(`Polling crawl job ${jobId}, attempt ${attempts + 1}`);
      
      const statusResponse = await fetch(`https://api.firecrawl.dev/v1/crawl/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
        }
      });

      if (!statusResponse.ok) {
        throw new Error(`Status check failed: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();
      console.log(`Job status: ${statusData.status}, completed: ${statusData.completed}/${statusData.total}`);

      if (statusData.status === 'completed') {
        // Process the completed crawl data
        const pages = statusData.data || [];
        console.log(`Crawl completed! Processing ${pages.length} pages`);

        for (const page of pages) {
          const { data: scanData } = await supabase.from('scans').select('url').eq('id', scanId).single();
          const baseUrl = scanData ? scanData.url : url;
          await processPage(page, scanId, supabase, baseUrl);
        }

        // Update scan status to completed
        await supabase
          .from('scans')
          .update({ status: 'completed' })
          .eq('id', scanId);

        console.log(`Successfully processed crawl job ${jobId}`);
        return;

      } else if (statusData.status === 'failed') {
        throw new Error(`Crawl job failed: ${statusData.error || 'Unknown error'}`);
      }

      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

    } catch (error) {
      console.error(`Error polling crawl job ${jobId}:`, error);
      
      await supabase
        .from('scans')
        .update({ 
          status: 'failed',
          error: error.message 
        })
        .eq('id', scanId);
      
      throw error;
    }
  }

  // Timeout reached
  await supabase
    .from('scans')
    .update({ 
      status: 'failed',
      error: 'Crawl job timed out' 
    })
    .eq('id', scanId);
  
  throw new Error('Crawl job timed out after 5 minutes');
}

async function processPage(page: any, scanId: string, supabase: any, baseUrl: string) {
  const { error: pageError } = await supabase
    .from('pages')
    .insert({
      scan_id: scanId,
      url: page.metadata?.url || page.url,
      title: page.metadata?.title,
      content: page.markdown || page.content,
      status_code: page.metadata?.statusCode || 200
    });

  if (pageError) {
    console.error('Error inserting page:', pageError);
    return;
  }

  // Extract and store links if available
  if (page.metadata?.links) {
    const { data: insertedPage } = await supabase
      .from('pages')
      .select('id')
      .eq('scan_id', scanId)
      .eq('url', page.metadata?.url || page.url)
      .single();

    if (insertedPage) {
      for (const link of page.metadata.links) {
        const hostname = new URL(baseUrl).hostname;
        const isInternal = link.href?.includes(hostname);
        
        await supabase
          .from('page_links')
          .insert({
            page_id: insertedPage.id,
            target_url: link.href,
            is_internal: isInternal,
            anchor_text: link.text
          });
      }
    }
  }
}