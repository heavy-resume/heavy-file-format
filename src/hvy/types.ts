export type JsonObject = Record<string, unknown>;

export interface HvySection {
  id: string;
  title: string;
  level: number;
  contentMarkdown: string;
  meta: JsonObject;
  children: HvySection[];
}

export interface HvyCssBlock {
  css: string;
  meta: JsonObject;
}

export interface HvyDocument {
  extension: '.hvy' | '.thvy' | '.md';
  meta: JsonObject;
  sections: HvySection[];
  cssBlocks: HvyCssBlock[];
  plugins: JsonObject[];
  sourceText: string;
  errors: string[];
}
