// Server-only Lovable AI helper. Do NOT import in client code.
export async function callLovableAIStructured<T>(
  systemPrompt: string,
  userPrompt: string,
  toolName: string,
  parameters: Record<string, unknown>,
  model = "google/gemini-3-flash-preview",
): Promise<T> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: { name: toolName, description: "Return structured result", parameters },
        },
      ],
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });
  if (res.status === 429) throw new Error("AI rate limit exceeded. Try again shortly.");
  if (res.status === 402)
    throw new Error("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI did not return structured output");
  return JSON.parse(args) as T;
}
