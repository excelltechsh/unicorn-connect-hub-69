import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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

    // Start background analysis
    EdgeRuntime.waitUntil(analyzePages(scanId, authHeader));

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Content analysis started' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in analyze-content:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function analyzePages(scanId: string, authHeader: string) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } }
  });

  try {
    console.log(`Starting content analysis for scan ${scanId}`);

    // Get all pages for this scan
    const { data: pages, error: pagesError } = await supabase
      .from('pages')
      .select('*')
      .eq('scan_id', scanId);

    if (pagesError) {
      throw pagesError;
    }

    console.log(`Analyzing ${pages.length} pages`);

    for (const page of pages) {
      if (!page.content) continue;

      const prompt = `
        Analyze the following web page content and provide actionable suggestions for improvement:

        URL: ${page.url}
        Title: ${page.title}
        Content: ${page.content.substring(0, 3000)}...

        Please provide suggestions in the following JSON format:
        {
          "seo": ["suggestion 1", "suggestion 2"],
          "content": ["suggestion 1", "suggestion 2"],
          "ux": ["suggestion 1", "suggestion 2"],
          "performance": ["suggestion 1", "suggestion 2"],
          "overall_score": 75
        }

        Focus on:
        - SEO improvements (meta tags, headers, keywords)
        - Content clarity and structure
        - User experience enhancements
        - Performance optimizations
        - Overall quality score (0-100)
      `;

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${googleApiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 1024,
            }
          })
        });

        if (!response.ok) {
          console.error(`Gemini API error for page ${page.id}:`, response.status);
          continue;
        }

        const result = await response.json();
        const analysisText = result.candidates?.[0]?.content?.parts?.[0]?.text;

        if (analysisText) {
          let suggestions;
          try {
            // Try to parse JSON from the response
            const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              suggestions = JSON.parse(jsonMatch[0]);
            } else {
              // Fallback if no JSON found
              suggestions = {
                content: [analysisText.substring(0, 500)],
                overall_score: 70
              };
            }
          } catch (parseError) {
            suggestions = {
              content: [analysisText.substring(0, 500)],
              overall_score: 70
            };
          }

          // Store suggestions
          await supabase
            .from('page_suggestions')
            .insert({
              page_id: page.id,
              model: 'gemini-2.0-flash-exp',
              suggestions: suggestions
            });

          console.log(`Analysis completed for page ${page.id}`);
        }

      } catch (apiError) {
        console.error(`Error analyzing page ${page.id}:`, apiError);
      }
    }

    console.log(`Content analysis completed for scan ${scanId}`);

  } catch (error) {
    console.error(`Error in analyzePages for scan ${scanId}:`, error);
  }
}