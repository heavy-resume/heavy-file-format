import type { HvyPlugin, HvyPluginContext, HvyPluginFactory, HvyPluginInstance } from '../../src/plugins/types';
import skillRatingDocumentation from './skill-rating.about.txt?raw';

import './skill-rating.css';

export const EXAMPLE_SKILL_RATING_PLUGIN_ID = 'example.skill-rating';

interface SkillRatingConfig {
  key: string;
  label: string;
  max: number;
}

const DEFAULT_CONFIG: SkillRatingConfig = {
  key: 'Strength',
  label: 'Strength',
  max: 5,
};

function readConfig(raw: Record<string, unknown>): SkillRatingConfig {
  const key = typeof raw.key === 'string' && raw.key.trim().length > 0 ? raw.key.trim() : DEFAULT_CONFIG.key;
  const label = typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : key;
  const max = Number.isFinite(Number(raw.max)) ? Math.max(1, Math.min(10, Math.trunc(Number(raw.max)))) : DEFAULT_CONFIG.max;
  return { key, label, max };
}

function readRating(ctx: HvyPluginContext, config: SkillRatingConfig): number {
  const source = ctx.sortValues.get(config.key);
  const value = Number(source);
  return Number.isFinite(value) ? Math.max(0, Math.min(config.max, value)) : 0;
}

function build(ctx: HvyPluginContext): HvyPluginInstance {
  const root = document.createElement('div');
  root.className = `hvy-skill-rating hvy-skill-rating-${ctx.mode}`;
  const head = document.createElement('div');
  head.className = 'hvy-skill-rating-head';
  const label = document.createElement('span');
  const valueLabel = document.createElement('span');
  valueLabel.className = 'hvy-skill-rating-value';
  head.append(label, valueLabel);
  const controls = document.createElement('div');
  controls.className = 'hvy-skill-rating-controls';
  root.append(head, controls);

  let config = readConfig(ctx.block.schema.pluginConfig);

  const sync = () => {
    config = readConfig(ctx.block.schema.pluginConfig);
    const rating = readRating(ctx, config);
    label.textContent = config.label;
    valueLabel.textContent = rating > 0 ? `${rating} / ${config.max}` : `0 / ${config.max}`;
    controls.style.setProperty('--hvy-skill-rating-count', String(config.max));
    const existingButtons = Array.from(controls.querySelectorAll<HTMLButtonElement>('[data-rating-value]'));
    if (existingButtons.length !== config.max) {
      controls.replaceChildren();
      for (let value = 1; value <= config.max; value += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hvy-skill-rating-button';
        button.dataset.ratingValue = String(value);
        controls.appendChild(button);
      }
    }
    for (let value = 1; value <= config.max; value += 1) {
      const button = controls.querySelector<HTMLButtonElement>(`[data-rating-value="${value}"]`);
      if (!button) continue;
      button.textContent = String(value);
      button.disabled = ctx.mode !== 'editor';
      button.setAttribute('aria-label', `${config.label}: ${value}`);
      button.classList.toggle('is-active', value <= rating);
      button.classList.toggle('is-selected', value === rating);
    }
  };

  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-rating-value]');
    if (!button || ctx.mode !== 'editor') return;
    const value = Number(button.dataset.ratingValue);
    if (!Number.isFinite(value)) return;
    ctx.sortValues.set(config.key, value);
  };

  if (ctx.mode === 'editor') {
    root.addEventListener('click', onClick);
  }

  sync();

  return {
    element: root,
    refresh: sync,
    unmount: () => {
      root.removeEventListener('click', onClick);
    },
  };
}

export const skillRatingExamplePluginFactory: HvyPluginFactory = build;

export const skillRatingExamplePlugin: HvyPlugin = {
  id: EXAMPLE_SKILL_RATING_PLUGIN_ID,
  displayName: 'Skill Rating Example',
  documentation: {
    filename: 'about-example-skill-rating.txt',
    text: skillRatingDocumentation,
  },
  aiHint: 'Example skill rating control. Set pluginConfig.key to the sort value name and use pluginSortValues for the selected rating.',
  aiHelp: [
    `Use \`<!--hvy:plugin {"plugin":"${EXAMPLE_SKILL_RATING_PLUGIN_ID}","pluginConfig":{"key":"Strength","label":"Strength","max":5},"pluginSortValues":{"Strength":3}}-->\`.`,
    'This is a reference-app example plugin, not a shipped built-in plugin.',
  ].join(' '),
  create: skillRatingExamplePluginFactory,
};
