import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Treatment plan mode
    if (body.mode === "treatment") {
      return await handleTreatment(body, LOVABLE_API_KEY);
    }

    // X-ray analysis mode
    const { imageBase64, patientData } = body;
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "No image provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patientContext = patientData
      ? `\n\nPatient Context: ${patientData.fullName}, Age ${patientData.age}, ${patientData.gender}, Height ${patientData.height}cm, Weight ${patientData.weight}kg. Current problem: ${patientData.currentProblem}. Symptoms: ${patientData.symptoms}. Smoking: ${patientData.smokingHistory}. Asthma history: ${patientData.asthma}. Previous respiratory: ${patientData.previousRespiratory}.`
      : "";

    const systemPrompt = `You are an expert radiologist AI specialized in chest X-ray analysis. Detect these conditions:

1. **Pneumonia** - consolidation, air bronchograms, ground-glass opacities, pleural effusions
2. **Tuberculosis (TB)** - upper lobe cavitations, hilar lymphadenopathy, miliary pattern
3. **COVID-19** - bilateral ground-glass opacities, peripheral distribution, crazy paving
4. **Asthma** - hyperinflation, flattened diaphragm, peribronchial thickening
5. **Lung Cancer** - masses/nodules, hilar enlargement, mediastinal widening

Respond ONLY with valid JSON:
{
  "conditions": [
    { "name": "Pneumonia", "confidence": 85, "severity": "Moderate", "findings": ["finding1", "finding2"] },
    { "name": "Tuberculosis", "confidence": 10, "severity": "None", "findings": ["finding1"] },
    { "name": "COVID-19", "confidence": 15, "severity": "None", "findings": ["finding1"] },
    { "name": "Asthma", "confidence": 5, "severity": "None", "findings": ["finding1"] },
    { "name": "Lung Cancer", "confidence": 8, "severity": "None", "findings": ["finding1"] }
  ],
  "overallAssessment": "Brief assessment",
  "recommendation": "Brief recommendation"
}

Be thorough and clinically accurate. Always include all 5 conditions.${patientContext}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this chest X-ray. Evaluate for all 5 conditions. Return ONLY valid JSON." },
              { type: "image_url", image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return jsonResponse({ error: "Rate limit exceeded" }, 429);
      if (response.status === 402) return jsonResponse({ error: "Payment required" }, 402);
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return jsonResponse({ error: "AI analysis failed" }, 500);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    let analysisResult;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysisResult = JSON.parse(jsonMatch[0]);
      else throw new Error("No JSON found");
    } catch {
      console.error("Parse error:", content);
      return jsonResponse({ error: "Failed to parse results" }, 500);
    }

    return jsonResponse(analysisResult);
  } catch (e) {
    console.error("analyze-xray error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function handleTreatment(body: any, apiKey: string) {
  const { analysisResults, patientData } = body;

  const topConditions = analysisResults.conditions
    ?.filter((c: any) => c.confidence > 20)
    .map((c: any) => `${c.name} (${c.confidence}% confidence, ${c.severity})`)
    .join(", ") || "No significant conditions detected";

  const patientContext = patientData
    ? `Patient: ${patientData.fullName}, Age ${patientData.age}, ${patientData.gender}. Problem: ${patientData.currentProblem}. Symptoms: ${patientData.symptoms}. Smoking: ${patientData.smokingHistory}. Allergies: ${patientData.knownAllergies}.`
    : "";

  const prompt = `Based on lung X-ray analysis showing: ${topConditions}
${patientContext}

Generate a treatment plan. Return ONLY valid JSON:
{
  "medications": [
    { "name": "Drug Name Dosage", "instruction": "How to take", "frequency": "Every X hours", "duration": "X days" }
  ],
  "diet": ["Dietary advice item 1", "Item 2"],
  "sleepRest": ["Rest guideline 1", "Guideline 2"],
  "doctorRecommendations": ["Recommendation 1", "Recommendation 2"],
  "lifestyleTips": ["Tip 1", "Tip 2"]
}

Provide 3-5 items per category. Be medically accurate and specific.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: "You are a medical AI assistant generating treatment plans based on X-ray analysis. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) return jsonResponse({ error: "Rate limit exceeded" }, 429);
    if (response.status === 402) return jsonResponse({ error: "Payment required" }, 402);
    return jsonResponse({ error: "Treatment generation failed" }, 500);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonResponse(JSON.parse(jsonMatch[0]));
    throw new Error("No JSON");
  } catch {
    console.error("Treatment parse error:", content);
    return jsonResponse({ error: "Failed to parse treatment" }, 500);
  }
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
