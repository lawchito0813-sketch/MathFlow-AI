import { TEST_API_CONFIG } from '../../config/test-api.js'

function buildProductionProviders() {
  return [
    {
      id: 'api1',
      label: 'API 1（Azure OpenAI）',
      description: 'Azure OpenAI provider',
      providerType: 'azure-openai',
      supportsPdfInput: true,
      endpoint: (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, ''),
      apiKey: process.env.AZURE_OPENAI_API_KEY || '',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_MODEL || '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-03-01-preview',
      model: process.env.AZURE_OPENAI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.1',
      modelHint: process.env.AZURE_OPENAI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5.1'
    },
    {
      id: 'api2',
      label: 'API 2（OpenAI-compatible）',
      description: 'OpenAI-compatible provider',
      providerType: 'openai-compatible',
      supportsPdfInput: false,
      baseUrl: (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, ''),
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN || '',
      model: process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'gpt-5.4',
      modelHint: process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || 'gpt-5.4'
    }
  ]
}

function getProviderRegistry() {
  const useTestConfig = process.env.NODE_ENV !== 'production'
  if (useTestConfig) {
    return {
      defaultProviderId: TEST_API_CONFIG.defaultProviderId,
      providers: TEST_API_CONFIG.providers
    }
  }

  return {
    defaultProviderId: 'api1',
    providers: buildProductionProviders()
  }
}

export function listModelPresets() {
  const registry = getProviderRegistry()
  return {
    defaultProviderId: registry.defaultProviderId,
    providers: registry.providers.map(provider => ({
      id: provider.id,
      label: provider.label,
      providerType: provider.providerType,
      modelHint: provider.modelHint || provider.model,
      description: provider.description || ''
    }))
  }
}

export function getModelConfig(providerId = '') {
  const registry = getProviderRegistry()
  const resolvedId = providerId || registry.defaultProviderId
  return registry.providers.find(provider => provider.id === resolvedId) || null
}

export function ensureModelConfig(providerId = '') {
  const config = getModelConfig(providerId)
  if (!config) {
    throw new Error('找不到對應的 API 提供者設定')
  }

  if (config.providerType === 'azure-openai') {
    if (!config.endpoint) throw new Error('缺少 AZURE_OPENAI_ENDPOINT')
    if (!config.apiKey) throw new Error('缺少 AZURE_OPENAI_API_KEY')
    if (!config.deployment) throw new Error('缺少 AZURE_OPENAI_DEPLOYMENT')
    if (!config.apiVersion) throw new Error('缺少 AZURE_OPENAI_API_VERSION')
    return config
  }

  if (config.providerType === 'gemini') {
    if (!config.apiKey) throw new Error('缺少 GEMINI_API_KEY')
    if (!config.model) throw new Error('缺少 GEMINI_MODEL')
    return config
  }

  if (!config.baseUrl) throw new Error('缺少 ANTHROPIC_BASE_URL')
  if (!config.apiKey) throw new Error('缺少 ANTHROPIC_AUTH_TOKEN')
  if (!config.model) throw new Error('缺少 ANTHROPIC_MODEL')
  return config
}
