export type JsonObject = Record<string, unknown>;

export interface HvySection {
  id: string;
  idGenerated?: boolean;
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
  extension: '.hvy' | '.thvy' | '.phvy' | '.md';
  meta: JsonObject;
  sections: HvySection[];
  cssBlocks: HvyCssBlock[];
  plugins: JsonObject[];
  sourceText: string;
  errors: string[];
}
