/**
 * eLaws Platform Adapter
 *
 * Adapter for eLaws platform (*.elaws.us) used by Dallas County.
 *
 * Platform Notes:
 * - eLaws is server-rendered HTML (Cheerio-compatible)
 * - Table of contents navigation on left side
 * - Content loads in main frame
 * - URLs may include section anchors
 *
 * Dallas County URL: http://dallascounty-tx.elaws.us/code/coor
 */

import * as cheerio from 'cheerio';
import { CountyAdapterBase } from './base';
import type { CountyOrdinance, CountyPlatform } from '../types';

/**
 * eLaws platform adapter
 *
 * Platform URL pattern: http://{county}-tx.elaws.us/code/coor
 */
export class ElawsAdapter extends CountyAdapterBase {
  county: string;
  fipsCode: string;
  baseUrl: string;
  platform: CountyPlatform = 'elaws';

  constructor(config: { county: string; fipsCode: string; baseUrl: string }) {
    super();
    this.county = config.county;
    this.fipsCode = config.fipsCode;
    this.baseUrl = config.baseUrl;
    // eLaws may be slower - increase rate limit
    this.rateLimit = 1000;
  }

  protected validateStructure($: cheerio.CheerioAPI): boolean {
    // Validate eLaws structure exists
    // eLaws typically has TOC items, code content, or table-based navigation
    return (
      // TOC navigation
      $('.toc-item').length > 0 ||
      $('frame').length > 0 ||
      $('a[href*="coor"]').length > 0 ||
      // Content structure
      $('table').length > 0 ||
      $('.code-section').length > 0 ||
      // Fallback: title contains "Code of Ordinances"
      $('title').text().toLowerCase().includes('code of ordinances') ||
      // Generic content indicators
      $('body').text().length > 500
    );
  }

  async *fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown> {
    console.log(`[ElawsAdapter] Starting fetch for ${this.county} County`);
    console.log(`[ElawsAdapter] Base URL: ${this.baseUrl}`);

    const $ = await this.loadPage(this.baseUrl);

    // eLaws typically has table of contents with links to sections
    const sectionLinks = this.extractSectionLinks($);
    console.log(`[ElawsAdapter] Found ${sectionLinks.length} section links`);

    for (const link of sectionLinks) {
      console.log(`[ElawsAdapter] Processing: ${link.title}`);

      await this.sleep(this.rateLimit);

      try {
        const section$ = await this.loadPage(link.url);
        const ordinance = this.parseSection(section$, link);

        if (ordinance) {
          yield ordinance;
        }
      } catch (error) {
        console.error(`[ElawsAdapter] Failed to fetch ${link.url}:`, error);
        // Continue with next section
      }
    }
  }

  /**
   * Extract section links from eLaws TOC page
   *
   * eLaws uses various HTML structures:
   * - Table-based navigation
   * - Anchor links with section references
   * - Nested lists for chapters/sections
   */
  private extractSectionLinks($: cheerio.CheerioAPI): Array<{
    url: string;
    title: string;
    chapter: string;
    section: string;
  }> {
    const links: Array<{
      url: string;
      title: string;
      chapter: string;
      section: string;
    }> = [];

    // Parse base URL parts for constructing absolute URLs
    const urlParts = new URL(this.baseUrl);
    const baseOrigin = urlParts.origin;
    const basePath = urlParts.pathname.replace(/\/[^/]*$/, ''); // Remove last segment

    // Try multiple selector strategies for eLaws
    const selectors = [
      // Primary: TOC items
      '.toc-item a',
      '#toc a',
      '.toc a',
      // Secondary: Table navigation (common in eLaws)
      'table a[href*="sec"]',
      'table a[href*="SEC"]',
      'table a[href*="ch"]',
      'table a[href*="CH"]',
      // Tertiary: Generic section links
      'a[href*="_sec"]',
      'a[href*="_SEC"]',
      'a[href*="article"]',
      // Fallback: Any substantive links
      'a[href*="coor"]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const href = $(el).attr('href');
        const title = $(el).text().trim();

        if (href && title && title.length > 0) {
          // Skip navigation/utility links
          const lowerTitle = title.toLowerCase();
          if (
            lowerTitle === 'home' ||
            lowerTitle === 'search' ||
            lowerTitle === 'help' ||
            lowerTitle === 'back'
          ) {
            return;
          }

          // Construct absolute URL
          let url: string;
          if (href.startsWith('http')) {
            url = href;
          } else if (href.startsWith('/')) {
            url = `${baseOrigin}${href}`;
          } else {
            url = `${baseOrigin}${basePath}/${href}`;
          }

          // Parse chapter/section from title
          // Pattern: "Chapter 1 - Title" or "Sec. 1.02 - Title" or "ARTICLE I"
          const chapterMatch =
            title.match(/Chapter\s+(\d+)/i) ||
            title.match(/CHAPTER\s+(\d+)/i) ||
            title.match(/Art(?:icle)?\.?\s*([IVXLCDM]+|\d+)/i);

          const sectionMatch =
            title.match(/Sec(?:tion)?\.?\s*([\d.]+)/i) ||
            title.match(/SEC(?:TION)?\.?\s*([\d.]+)/i) ||
            title.match(/^([\d.]+)\s/);

          // Avoid duplicates
          if (!links.some((l) => l.url === url)) {
            links.push({
              url,
              title,
              chapter: chapterMatch?.[1] ?? '0',
              section: sectionMatch?.[1] ?? '0',
            });
          }
        }
      });

      if (links.length > 0) break;
    }

    // Sort by chapter then section numerically
    return links.sort((a, b) => {
      const chA = parseFloat(a.chapter) || 0;
      const chB = parseFloat(b.chapter) || 0;
      if (chA !== chB) return chA - chB;

      const secA = parseFloat(a.section) || 0;
      const secB = parseFloat(b.section) || 0;
      return secA - secB;
    });
  }

  /**
   * Parse section content from an eLaws section page
   */
  private parseSection(
    $: cheerio.CheerioAPI,
    link: { chapter: string; section: string; url: string; title: string }
  ): CountyOrdinance | null {
    // Extract heading from multiple possible locations
    const heading =
      $('h1').first().text().trim() ||
      $('h2').first().text().trim() ||
      $('.section-title').first().text().trim() ||
      $('title').text().trim() ||
      link.title;

    // Extract text from section content
    // eLaws typically uses various content containers
    const textSelectors = [
      '.section-text',
      '.content',
      '.code-text',
      'main p',
      'article p',
      // eLaws often uses tables for content layout
      'table td',
      // Fallback: body text excluding navigation
      'body',
    ];

    let text = '';
    for (const selector of textSelectors) {
      const content = $(selector)
        .clone()
        .find('script, style, nav, .toc, #toc')
        .remove()
        .end()
        .text()
        .trim();

      if (content && content.length > 100) {
        text = content;
        break;
      }
    }

    // If no substantial content, use full body text cleaned up
    if (!text || text.length < 100) {
      text = $('body')
        .clone()
        .find('script, style, nav, .toc, #toc, header, footer')
        .remove()
        .end()
        .text()
        .trim()
        .replace(/\s+/g, ' '); // Normalize whitespace
    }

    // Skip if no meaningful content
    if (!text || text.length < 50) {
      console.log(`[ElawsAdapter] Skipping ${link.url} - insufficient content`);
      return null;
    }

    return {
      county: this.county,
      fipsCode: this.fipsCode,
      chapter: link.chapter,
      section: link.section,
      heading: heading || `Section ${link.section}`,
      text,
      sourceUrl: link.url,
      scrapedAt: new Date().toISOString(),
    };
  }
}
