import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const tavilyApiKey = Deno.env.get('TAVILY_API_KEY')!;
const googleApiKey = Deno.env.get('GOOGLE_API_KEY')!;

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

    const { scanId } = await req.json();
    
    if (!scanId) {
      throw new Error('Scan ID is required');
    }

    // Start background research
    EdgeRuntime.waitUntil(conductMarketResearch(scanId, authHeader));

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Market research started' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in market-research:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function conductMarketResearch(scanId: string, authHeader: string) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    console.log(`Starting market research for scan ${scanId}`);

    // Get scan details
    const { data: scan, error: scanError } = await supabase
      .from('scans')
      .select('url')
      .eq('id', scanId)
      .single();

    if (scanError) {
      console.error(`Failed to fetch scan ${scanId}:`, scanError);
      throw scanError;
    }

    console.log(`Fetched scan data for ${scan.url}`);
    const domain = new URL(scan.url).hostname;
    
    // Extract industry/niche from domain or content
    const researchQueries = [
      `competitors of ${domain}`,
      `${domain} industry trends 2024`,
      `best practices ${domain} industry`,
      `customer pain points ${domain} niche`
    ];

    let allSources = [];
    let researchData = {};
    let tavilySuccessCount = 0;

    // Conduct research with Tavily
    console.log(`Starting Tavily research with ${researchQueries.length} queries`);
    for (const query of researchQueries) {
      try {
        console.log(`Executing Tavily query: "${query}"`);
        const tavilyResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: tavilyApiKey,
            query: query,
            search_depth: "advanced",
            max_results: 5
          })
        });

        console.log(`Tavily response status for "${query}": ${tavilyResponse.status}`);

        if (tavilyResponse.ok) {
          const data = await tavilyResponse.json();
          if (data.results && data.results.length > 0) {
            allSources.push(...data.results);
            researchData[query] = data.results;
            tavilySuccessCount++;
            console.log(`Tavily query "${query}" returned ${data.results.length} results`);
          } else {
            console.warn(`Tavily query "${query}" returned no results`);
          }
        } else {
          const errorText = await tavilyResponse.text();
          console.error(`Tavily API error for query "${query}": ${tavilyResponse.status} - ${errorText}`);
        }
      } catch (error) {
        console.error(`Exception with Tavily query "${query}":`, error instanceof Error ? error.message : error);
      }
    }

    console.log(`Tavily research completed: ${tavilySuccessCount}/${researchQueries.length} queries successful, ${allSources.length} total sources`);

    // Check if we have any research data
    if (allSources.length === 0) {
      console.error(`No research data collected from Tavily for scan ${scanId}`);
      // Store empty insights to indicate the attempt was made but failed
      await supabase
        .from('market_insights')
        .insert({
          scan_id: scanId,
          model: 'gemini-1.5-flash',
          insights: { error: 'No research data available from Tavily API' },
          sources: []
        });
      return;
    }

    // Analyze research with Gemini
    console.log(`Starting Gemini analysis with ${allSources.length} sources`);
    const analysisPrompt = `
      Based on the following market research data, provide insights for the website ${scan.url}:

      Research Data: ${JSON.stringify(researchData, null, 2)}

      Please analyze and provide insights in the following JSON format:
      {
        "competitors": [
          {"name": "Competitor 1", "strengths": ["strength 1"], "website": "url"}
        ],
        "trending_topics": ["topic 1", "topic 2"],
        "market_gaps": ["gap 1", "gap 2"],
        "content_opportunities": ["opportunity 1", "opportunity 2"],
        "seo_keywords": ["keyword 1", "keyword 2"],
        "industry_insights": ["insight 1", "insight 2"]
      }

      Focus on actionable insights that can help improve the website's competitive position.
    `;

    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`;
      console.log(`Calling Gemini API at: ${geminiUrl.replace(googleApiKey, 'REDACTED')}`);
      
      const geminiResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: analysisPrompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          }
        })
      });

      console.log(`Gemini API response status: ${geminiResponse.status}`);

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        console.error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
        
        // Store raw research data even if Gemini fails
        await supabase
          .from('market_insights')
          .insert({
            scan_id: scanId,
            model: 'gemini-1.5-flash',
            insights: { 
              error: 'Gemini analysis failed',
              raw_research_data: researchData 
            },
            sources: allSources
          });
        console.log(`Stored raw research data for scan ${scanId} despite Gemini failure`);
        return;
      }

      const result = await geminiResponse.json();
      console.log(`Gemini API response structure: ${JSON.stringify(Object.keys(result))}`);
      
      const analysisText = result.candidates?.[0]?.content?.parts?.[0]?.text;

      if (analysisText) {
        console.log(`Gemini returned analysis text (${analysisText.length} chars)`);
        let insights;
        try {
          const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            insights = JSON.parse(jsonMatch[0]);
            console.log(`Successfully parsed Gemini JSON response`);
          } else {
            console.warn(`No JSON found in Gemini response, storing as raw analysis`);
            insights = { raw_analysis: analysisText };
          }
        } catch (parseError) {
          console.error(`Failed to parse Gemini JSON:`, parseError instanceof Error ? parseError.message : parseError);
          insights = { raw_analysis: analysisText };
        }

        // Store market insights
        const { error: insertError } = await supabase
          .from('market_insights')
          .insert({
            scan_id: scanId,
            model: 'gemini-2.0-flash-exp',
            insights: insights,
            sources: allSources
          });

        if (insertError) {
          console.error(`Failed to insert market insights for scan ${scanId}:`, insertError);
        } else {
          console.log(`Market research completed successfully for scan ${scanId}`);
        }
      } else {
        console.error(`Gemini returned no analysis text for scan ${scanId}`);
        // Store sources even if no analysis
        await supabase
          .from('market_insights')
          .insert({
            scan_id: scanId,
            model: 'gemini-1.5-flash',
            insights: { error: 'No analysis text returned from Gemini' },
            sources: allSources
          });
      }

    } catch (apiError) {
      console.error(`Exception with Gemini analysis for scan ${scanId}:`, apiError instanceof Error ? apiError.message : apiError);
      // Store raw research data as fallback
      await supabase
        .from('market_insights')
        .insert({
          scan_id: scanId,
          model: 'gemini-1.5-flash',
          insights: { 
            error: 'Gemini API exception',
            raw_research_data: researchData 
          },
          sources: allSources
        });
    }

  } catch (error) {
    console.error(`Fatal error in conductMarketResearch for scan ${scanId}:`, error instanceof Error ? error.message : error);
    console.error(`Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
  }
}