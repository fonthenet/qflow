'use client';

import { useEffect } from 'react';
import { useI18n } from '@/components/providers/locale-provider';
import { translate } from '@/lib/i18n/shared';
import type { AppLocale } from '@/lib/i18n/messages';

function preserveWhitespace(original: string, translated: string) {
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

function translateTextValue(locale: AppLocale, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = translate(locale, trimmed);
  if (translated === trimmed) return value;
  return preserveWhitespace(value, translated);
}

function translateNodeTree(root: Node, locale: AppLocale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();

  while (current) {
    const parent = current.parentElement;
    if (
      parent &&
      !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA'].includes(parent.tagName) &&
      !(parent instanceof HTMLInputElement)
    ) {
      const nextValue = translateTextValue(locale, current.textContent ?? '');
      if (nextValue !== current.textContent) {
        current.textContent = nextValue;
      }
    }
    current = walker.nextNode();
  }

  if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
    const elements =
      root instanceof Element
        ? [root, ...Array.from(root.querySelectorAll('*'))]
        : Array.from(root.querySelectorAll('*'));

    for (const element of elements) {
      for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const nextValue = translateTextValue(locale, value);
        if (nextValue !== value) {
          element.setAttribute(attr, nextValue);
        }
      }

      if (
        element instanceof HTMLInputElement &&
        ['button', 'submit', 'reset'].includes(element.type)
      ) {
        const nextValue = translateTextValue(locale, element.value);
        if (nextValue !== element.value) {
          element.value = nextValue;
        }
      }
    }
  }
}

export function TranslationRuntime() {
  const { locale } = useI18n();

  useEffect(() => {
    if (locale === 'en') return;

    const originalAlert = window.alert.bind(window);
    const originalConfirm = window.confirm.bind(window);
    const originalPrompt = window.prompt.bind(window);

    window.alert = (message?: string) => originalAlert(translate(locale, String(message ?? '')));
    window.confirm = (message?: string) => originalConfirm(translate(locale, String(message ?? '')));
    window.prompt = (message?: string, defaultValue?: string) =>
      originalPrompt(translate(locale, String(message ?? '')), defaultValue);

    document.title = translateTextValue(locale, document.title);
    translateNodeTree(document.body, locale);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const target = mutation.target;
          const nextValue = translateTextValue(locale, target.textContent ?? '');
          if (nextValue !== target.textContent) {
            target.textContent = nextValue;
          }
          continue;
        }

        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          translateNodeTree(mutation.target, locale);
          continue;
        }

        mutation.addedNodes.forEach((node) => translateNodeTree(node, locale));
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt', 'value'],
    });

    return () => {
      observer.disconnect();
      window.alert = originalAlert;
      window.confirm = originalConfirm;
      window.prompt = originalPrompt;
    };
  }, [locale]);

  return null;
}
