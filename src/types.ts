export interface CNPJInfo {
  cnpj: string;
  cnpjFormatado: string;
  status: 'pending' | 'searching' | 'success' | 'failed';
  nomeCliente: string;
  cnae: string;
  descricaoCnae: string;
  segmento: string;
  origem: 'brasilapi' | 'google_search' | 'local_classification' | 'unknown';
  error?: string;
}

export interface PDFExtractionResponse {
  cnpjs: string[];
  message?: string;
}
