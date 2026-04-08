export const TEST_API_CONFIG = {
  defaultProviderId: 'api1',
  providers: [
    {
      id: 'api1',
      label: 'API 1（Azure OpenAI）',
      description: '示例配置：Azure OpenAI / gpt-5.1',
      providerType: 'azure-openai',
      supportsPdfInput: true,
      endpoint: 'https://your-resource.openai.azure.com',
      apiKey: process.env.AZURE_OPENAI_API_KEY || 'your-azure-openai-api-key',
      deployment: 'gpt-5.1',
      apiVersion: '2025-03-01-preview',
      model: 'gpt-5.1',
      modelHint: 'gpt-5.1'
    },
    {
      id: 'api2',
      label: 'API 2（OpenAI-compatible）',
      description: '示例配置：OpenAI-compatible / gpt-5.4',
      providerType: 'openai-compatible',
      supportsPdfInput: false,
      baseUrl: 'https://api.example.com',
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY || 'your-openai-compatible-api-key',
      model: 'gpt-5.4',
      modelHint: 'gpt-5.4'
    },
    {
      id: 'api3',
      label: 'API 3（Google AI Studio）',
      description: '示例配置：Gemini 3.1 Pro Preview / full-page review',
      providerType: 'gemini',
      supportsPdfInput: true,
      apiKey: process.env.GEMINI_API_KEY || 'your-gemini-api-key',
      model: 'gemini-3.1-pro-preview',
      modelHint: 'gemini-3.1-pro-preview'
    },
    {
      id: 'api4',
      label: 'API 4（OpenAI-compatible）',
      description: '示例配置：OpenAI-compatible / gemini-3-pro-preview',
      providerType: 'openai-compatible',
      supportsPdfInput: false,
      baseUrl: 'https://api.example.com',
      apiKey: process.env.OPENAI_COMPATIBLE_API_KEY_2 || 'your-openai-compatible-api-key-2',
      model: 'gemini-3-pro-preview',
      modelHint: 'gemini-3-pro-preview'
    }
  ]
}
