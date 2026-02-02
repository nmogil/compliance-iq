/**
 * Municode Library Adapter
 *
 * Adapter for library.municode.com platform used by 9 of 10 target Texas counties:
 * - Harris, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso
 *
 * Platform Notes:
 * - Municode Library is a SPA (Single Page Application)
 * - Initial page load returns static HTML with TOC structure
 * - Content may require JavaScript rendering for full extraction
 * - May need API discovery or Playwright for complete scraping
 *
 * Current Implementation:
 * - Fetches TOC structure from static HTML
 * - Extracts chapter/section links
 * - Navigates to individual sections for content
 */

import * as cheerio from 'cheerio';
import { CountyAdapterBase } from './base';
import type { CountyOrdinance, CountyPlatform } from '../types';

/**
 * Municode Library adapter for Texas counties
 *
 * Platform URL pattern: https://library.municode.com/tx/{county}/codes/code_of_ordinances
 */
export class MunicodeAdapter extends CountyAdapterBase {
  county: string;
  fipsCode: string;
  baseUrl: string;
  platform: CountyPlatform = 'municode';

  constructor(config: { county: string; fipsCode: string; baseUrl: string }) {
    super();
    this.county = config.county;
    this.fipsCode = config.fipsCode;
    this.baseUrl = config.baseUrl;
    // Municode may be rate-limited - use conservative delay
    this.rateLimit = 1000;
  }

  protected validateStructure($: cheerio.CheerioAPI): boolean {
    // Validate Municode Library structure exists
    // Multiple fallback selectors for robustness
    return (
      // SPA container elements
      $('#codebankToggle').length > 0 ||
      $('.toc').length > 0 ||
      $('[data-testid]').length > 0 ||
      // Static HTML elements
      $('.codes-title').length > 0 ||
      $('a[href*="/codes/"]').length > 0 ||
      // Generic content indicators
      $('main').length > 0 ||
      $('article').length > 0
    );
  }

  async *fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown> {
    console.log(`[MunicodeAdapter] Starting fetch for ${this.county} County`);
    console.log(`[MunicodeAdapter] Base URL: ${this.baseUrl}`);

    const $ = await this.loadPage(this.baseUrl);

    // Extract chapter links from TOC
    const chapterLinks = this.extractChapterLinks($);
    console.log(`[MunicodeAdapter] Found ${chapterLinks.length} chapters`);

    for (const link of chapterLinks) {
      console.log(`[MunicodeAdapter] Processing chapter: ${link.title}`);

      await this.sleep(this.rateLimit);

      try {
        const chapter$ = await this.loadPage(link.url);
        const sections = this.extractSections(chapter$, link);

        for (const section of sections) {
          yield section;
        }
      } catch (error) {
        console.error(`[MunicodeAdapter] Failed to fetch chapter ${link.chapter}:`, error);
        // Continue with next chapter
      }
    }
  }

  /**
   * Extract chapter links from TOC page
   *
   * Tries multiple selector strategies for robustness across
   * different Municode page structures.
   */
  private extractChapterLinks(
    $: cheerio.CheerioAPI
  ): Array<{ url: string; title: string; chapter: string }> {
    const links: Array<{ url: string; title: string; chapter: string }> = [];

    // Multiple selector strategies for Municode TOC
    const selectors = [
      // Primary: TOC chapter links
      '.toc-link',
      '.toc-item a',
      '[data-toc-item] a',
      // Secondary: Code navigation
      '.codes-toc a',
      'nav.toc a',
      // Tertiary: Generic chapter links
      'a[href*="nodeId"]',
      'a[href*="CHAPTER"]',
      'a[href*="chapter"]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();

        if (href && title && title.length > 0) {
          // Skip non-chapter links (e.g., search, help)
          if (title.toLowerCase().includes('search') || title.toLowerCase().includes('help')) {
            return;
          }

          const url = href.startsWith('http')
            ? href
            : href.startsWith('/')
              ? `https://library.municode.com${href}`
              : `${this.baseUrl}/${href}`;

          // Parse chapter number from title
          const chapterMatch = title.match(/Chapter\s+(\d+)/i) || title.match(/^(\d+)\./);
          const chapter = chapterMatch?.[1] ?? '0';

          // Avoid duplicates
          if (!links.some((l) => l.url === url)) {
            links.push({ url, title, chapter });
          }
        }
      });

      if (links.length > 0) break;
    }

    // Sort chapters numerically
    return links.sort((a, b) => {
      const numA = parseInt(a.chapter, 10);
      const numB = parseInt(b.chapter, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.chapter.localeCompare(b.chapter);
    });
  }

  /**
   * Extract sections from a chapter page
   */
  private extractSections(
    $: cheerio.CheerioAPI,
    chapter: { chapter: string; url: string }
  ): CountyOrdinance[] {
    const sections: CountyOrdinance[] = [];

    // Multiple selector strategies for section content
    const sectionSelectors = [
      // Primary: Section containers
      '.chunk-content',
      '.section-content',
      '[data-section]',
      // Secondary: Generic content
      'article section',
      '.code-section',
      // Tertiary: Fallback
      '.content-area p',
    ];

    for (const selector of sectionSelectors) {
      $(selector).each((_, el) => {
        const $section = $(el);

        // Extract heading
        const heading =
          $section.find('h1, h2, h3, .section-heading, .section-title').first().text().trim() ||
          $section.find('strong, b').first().text().trim();

        // Extract text content
        const text = $section
          .find('p, .section-text, .section-body')
          .map((_, p) => $(p).text().trim())
          .get()
          .join('\n\n');

        // Extract section number from heading
        const sectionMatch =
          heading.match(/(?:Section|Sec\.?)\s*([\d.-]+)/i) || heading.match(/^([\d.-]+)/);

        if (heading && text && text.length > 50) {
          // Require meaningful content
          sections.push({
            county: this.county,
            fipsCode: this.fipsCode,
            chapter: chapter.chapter,
            section: sectionMatch?.[1] ?? '0',
            heading,
            text,
            sourceUrl: chapter.url,
            scrapedAt: new Date().toISOString(),
          });
        }
      });

      if (sections.length > 0) break;
    }

    // If no structured sections found, try extracting full page content
    if (sections.length === 0) {
      const pageTitle = $('h1, .page-title').first().text().trim();
      const pageContent = $('main, article, .content').first().text().trim();

      if (pageContent && pageContent.length > 100) {
        sections.push({
          county: this.county,
          fipsCode: this.fipsCode,
          chapter: chapter.chapter,
          section: '0',
          heading: pageTitle || `Chapter ${chapter.chapter}`,
          text: pageContent,
          sourceUrl: chapter.url,
          scrapedAt: new Date().toISOString(),
        });
      }
    }

    return sections;
  }
}
