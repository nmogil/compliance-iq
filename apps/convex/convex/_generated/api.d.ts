/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_query from "../actions/query.js";
import type * as conversations from "../conversations.js";
import type * as jurisdictions from "../jurisdictions.js";
import type * as lib_confidence from "../lib/confidence.js";
import type * as lib_embed from "../lib/embed.js";
import type * as lib_generate from "../lib/generate.js";
import type * as lib_geocode from "../lib/geocode.js";
import type * as lib_parse from "../lib/parse.js";
import type * as lib_prompt from "../lib/prompt.js";
import type * as lib_retrieve from "../lib/retrieve.js";
import type * as messages from "../messages.js";
import type * as mutations_saveQuery from "../mutations/saveQuery.js";
import type * as queries_getHistory from "../queries/getHistory.js";
import type * as queries_getQuery from "../queries/getQuery.js";
import type * as query_types from "../query/types.js";
import type * as sources from "../sources.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/query": typeof actions_query;
  conversations: typeof conversations;
  jurisdictions: typeof jurisdictions;
  "lib/confidence": typeof lib_confidence;
  "lib/embed": typeof lib_embed;
  "lib/generate": typeof lib_generate;
  "lib/geocode": typeof lib_geocode;
  "lib/parse": typeof lib_parse;
  "lib/prompt": typeof lib_prompt;
  "lib/retrieve": typeof lib_retrieve;
  messages: typeof messages;
  "mutations/saveQuery": typeof mutations_saveQuery;
  "queries/getHistory": typeof queries_getHistory;
  "queries/getQuery": typeof queries_getQuery;
  "query/types": typeof query_types;
  sources: typeof sources;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
