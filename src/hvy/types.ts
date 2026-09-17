export type JsonObject = Record<string, unknown>;

export interface HvySection {
  id: string;
  idGenerated?: boolean;
  title: string;
  contentMarkdown: string;
  meta: JsonObject;
}

export interface HvyCssBlock {
  css: string;
  meta: JsonObject;
}

export interface HvyDocument {
  extension: '.hvy' | '.thvy' | '.phvy' | '.md';
  meta: JsonObject;
  sections: HvySection[];
  cssBlocks: HvyCssBlock[];
  plugins: JsonObject[];
  sourceText: string;
  errors: string[];
}
