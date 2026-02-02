/**
 * American Legal Publishing Adapter
 *
 * Adapter for American Legal Publishing platform (codelibrary.amlegal.com).
 *
 * COMPLIANCE REQUIREMENTS (from robots.txt):
 * - 5-second crawl delay required
 * - User-Agent must not be in blocked list (ClaudeBot, GPTBot, etc.)
 * - Content-Signal: search=yes, ai-train=no
 *
 * Note: No Texas counties in our target 10 currently use AmLegal,
 * but this adapter is prepared for future expansion or if sources change.
 *
 * Platform URL pattern: https://codelibrary.amlegal.com/codes/{jurisdiction}/latest/overview
 */

import * as cheerio from 'cheerio';
import { CountyAdapterBase } from './base';
import type { CountyOrdinance, CountyPlatform } from '../types';

/**
 * American Legal Publishing adapter
 *
 * Implements robots.txt compliance with 5-second crawl delay.
 * Uses compliant User-Agent (not in blocked list).
 */
export class AmlegalAdapter extends CountyAdapterBase {
  county: string;
  fipsCode: string;
  baseUrl: string;
  platform: CountyPlatform = 'amlegal';

  constructor(config: { county: string; fipsCode: string; baseUrl: string }) {
    super();
    this.county = config.county;
    this.fipsCode = config.fipsCode;
    this.baseUrl = config.baseUrl;

    // American Legal requires 5-second delay per robots.txt
    this.rateLimit = 5000;

    // Use compliant User-Agent (not in blocked list)
    this.userAgent = 'ComplianceIQ/1.0 Legal Research (+https://compliance-iq.com)';
  }

  protected validateStructure($: cheerio.CheerioAPI): boolean {
    // Validate AmLegal structure exists
    // AmLegal uses node-based navigation and code sections
    return (
      // Navigation structure
      $('.code-section').length > 0 ||
      $('.toc-node').length > 0 ||
      $('[data-node-id]').length > 0 ||
      // Content structure
      $('.node-content').length > 0 ||
      $('.code-content').length > 0 ||
      // Fallback: generic page structure
      $('main').length > 0 ||
      $('article').length > 0 ||
      // Title check
      $('title').text().toLowerCase().includes('code') ||
      $('title').text().toLowerCase().includes('ordinance')
    );
  }

  async *fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown> {
    console.log(`[AmlegalAdapter] Starting fetch for ${this.county} County`);
    console.log(`[AmlegalAdapter] Using 5-second delay per robots.txt compliance`);
    console.log(`[AmlegalAdapter] Base URL: ${this.baseUrl}`);

    const $ = await this.loadPage(this.baseUrl);

    // AmLegal uses tree navigation with node IDs
    const nodes = this.extractTocNodes($);
    console.log(`[AmlegalAdapter] Found ${nodes.length} TOC nodes`);

    for (const node of nodes) {
      console.log(`[AmlegalAdapter] Processing: ${node.title} (5s delay)`);

      await this.sleep(this.rateLimit);

      try {
        const section$ = await this.loadPage(node.url);
        const ordinance = this.parseNode(section$, node);

        if (ordinance) {
          yield ordinance;
        }
      } catch (error) {
        console.error(`[AmlegalAdapter] Failed to fetch ${node.url}:`, error);
        // Continue with next node
      }
    }
  }

  /**
   * Extract TOC nodes from AmLegal overview page
   *
   * AmLegal uses data attributes for node identification
   * and tree-based navigation.
   */
  private extractTocNodes($: cheerio.CheerioAPI): Array<{
    url: string;
    title: string;
    nodeId: string;
    chapter: string;
    section: string;
  }> {
    const nodes: Array<{
      url: string;
      title: string;
      nodeId: string;
      chapter: string;
      section: string;
    }> = [];

    // Parse base URL for constructing absolute URLs
    const urlParts = new URL(this.baseUrl);
    const baseOrigin = urlParts.origin;

    // Multiple selector strategies for AmLegal TOC
    const selectors = [
      // Primary: Data attribute navigation
      '[data-node-id]',
      '[data-nodeid]',
      // Secondary: Class-based navigation
      '.toc-node a',
      '.toc-item a',
      '.tree-node a',
      // Tertiary: Generic navigation
      'nav a[href*="node"]',
      'a[href*="nodeId"]',
      'a[href*="NODEID"]',
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        const $el = $(el);
        const nodeId = $el.attr('data-node-id') || $el.attr('data-nodeid') || '';
        const href = $el.attr('href') || '';
        const title = $el.text().trim();

        if (title && title.length > 0) {
          // Skip utility links
          const lowerTitle = title.toLowerCase();
          if (
            lowerTitle === 'search' ||
            lowerTitle === 'help' ||
            lowerTitle === 'home' ||
            lowerTitle === 'print'
          ) {
            return;
          }

          // Construct absolute URL
          let url: string;
          if (href.startsWith('http')) {
            url = href;
          } else if (href.startsWith('/')) {
            url = `${baseOrigin}${href}`;
          } else if (href) {
            const baseWithoutOverview = this.baseUrl.replace(/\/overview$/, '');
            url = `${baseWithoutOverview}/${href}`;
          } else {
            // No href - skip
            return;
          }

          // Parse chapter/section from node ID or title
          const chapterMatch =
            title.match(/Chapter\s+(\d+)/i) ||
            nodeId.match(/CHAPTER_?(\d+)/i) ||
            title.match(/^(\d+)\./);

          const sectionMatch =
            title.match(/Sec(?:tion)?\.?\s*([\d.]+)/i) ||
            nodeId.match(/SEC(?:TION)?_?([\d.]+)/i) ||
            title.match(/^[\d.]+[.-]([\d.]+)/);

          // Avoid duplicates
          if (!nodes.some((n) => n.url === url)) {
            nodes.push({
              url,
              title,
              nodeId: nodeId || url,
              chapter: chapterMatch?.[1] ?? '0',
              section: sectionMatch?.[1] ?? '0',
            });
          }
        }
      });

      if (nodes.length > 0) break;
    }

    // Sort by chapter then section numerically
    return nodes.sort((a, b) => {
      const chA = parseFloat(a.chapter) || 0;
      const chB = parseFloat(b.chapter) || 0;
      if (chA !== chB) return chA - chB;

      const secA = parseFloat(a.section) || 0;
      const secB = parseFloat(b.section) || 0;
      return secA - secB;
    });
  }

  /**
   * Parse content from an AmLegal node page
   */
  private parseNode(
    $: cheerio.CheerioAPI,
    node: { chapter: string; section: string; url: string; title: string }
  ): CountyOrdinance | null {
    // Extract heading from multiple locations
    const heading =
      $('.section-heading').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('h2').first().text().trim() ||
      $('.node-title').first().text().trim() ||
      node.title;

    // Extract content from section body
    const textSelectors = [
      '.section-content',
      '.code-text',
      '.node-content',
      'main .content',
      'article',
      '.code-body',
    ];

    let text = '';
    for (const selector of textSelectors) {
      const content = $(selector)
        .clone()
        .find('script, style, nav, .toc, .sidebar')
        .remove()
        .end()
        .text()
        .trim();

      if (content && content.length > 100) {
        text = content;
        break;
      }
    }

    // Fallback: extract from main content area
    if (!text || text.length < 100) {
      text = $('main, article, .content, body')
        .first()
        .clone()
        .find('script, style, nav, header, footer, .sidebar')
        .remove()
        .end()
        .text()
        .trim()
        .replace(/\s+/g, ' ');
    }

    // Skip if no meaningful content
    if (!text || text.length < 50) {
      console.log(`[AmlegalAdapter] Skipping ${node.url} - insufficient content`);
      return null;
    }

    return {
      county: this.county,
      fipsCode: this.fipsCode,
      chapter: node.chapter,
      section: node.section,
      heading: heading || `Section ${node.section}`,
      text,
      sourceUrl: node.url,
      scrapedAt: new Date().toISOString(),
    };
  }
}
