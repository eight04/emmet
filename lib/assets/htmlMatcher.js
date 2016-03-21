/**
 * @author Sergey Chikuyonok (serge.che@gmail.com)
 * @link http://chikuyonok.ru
 */
if (typeof module === 'object' && typeof define !== 'function') {
	var define = function (factory) {
		module.exports = factory(require, exports, module);
	};
}

define(function(require, exports, module) {
	var range = require('./range');
	// Regular Expressions for parsing tags and attributes
	// 1=name, 2=attributes, 3=closeSelf
	var start_tag = /^<([\w\:\-]+)((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/,
		// 2=name
		end_tag = /^<\/([\w\:\-]+)[^>]*>/;

	function tag(match, ix, type) {
		var name = match[1].toLowerCase();
		return {
			id: (type == "open" ? "<" : "</") + name,
			name: name,
			type: type,
			selfClose: !!match[3],
			range: range(ix, match[0])
		};
	}

	function comment(start, end) {
		return {
			start: start,
			end: end,
			type: 'comment',
			range: range(start, end - start)
		};
	}

	/**
	 * Makes selection ranges for matched tag pair
	 * @param {tag} opening_tag
	 * @param {tag} closing_tag
	 * @param {Number} ix
	 */
	function makeRange(opening_tag, closing_tag, ix, text) {
		var open = opening_tag,
			close = closing_tag,
			pos = ix;

		if (!open) {
			return null;
		}

		var outerRange = null;
		var innerRange = null;

		if (close) {
			outerRange = range.create2(open.range.start, close.range.end);
			innerRange = range.create2(open.range.end, close.range.start);
		} else {
			outerRange = innerRange = range.create2(open.range.start, open.range.end);
		}

		if (open.type == 'comment') {
			// adjust positions of inner range for comment
			var _c = outerRange.substring(text);
			innerRange.start += _c.length - _c.replace(/^<\!--\s*/, '').length;
			innerRange.end -= _c.length - _c.replace(/\s*-->$/, '').length;
		}

		return {
			open: opening_tag,
			close: closing_tag,
			type: open.type == 'comment' ? 'comment' : 'tag',
			innerRange: innerRange,
			innerContent: function() {
				return this.innerRange.substring(text);
			},
			outerRange: outerRange,
			outerContent: function() {
				return this.outerRange.substring(text);
			},
			range: !innerRange.length() || !innerRange.cmp(pos, 'lte', 'gte') ? outerRange : innerRange,
			content: function() {
				return this.range.substring(text);
			},
			source: text
		};
	}

	function createMatcher(text, pos) {
		var iB = pos - 1, iF = pos,
			stackB = [], stackF = [],
			foundB, foundF,
			endB, endF,
			hit;

		function matchTag(pos) {
			var match;
			if (text[pos + 1] == "/") {
				// close
				if (match = text.substr(pos).match(end_tag)) {
					return tag(match, pos, "close");
				}
			} else if (text[pos + 1] == "!" && text[pos + 2] == "-" && text[pos + 3] == "-") {
				// comment
				if ((match = text.indexOf("-->", pos + 4)) >= 0) {
					return comment(pos, match + 3);
				}
			} else if (match = text.substr(pos).match(start_tag)) {
				// open
				return tag(match, pos, "open");
			}
		}
		
		function createForwardMainTree() {
			var unary = {},
				search = ,
				o = {
					stack: [],
					finished: false,
					matches: [{
						i: pos,
						token: "<",
						tag: null,
						excludes: [],
						excludeName: unary
					}]
				},
				tree = createTree(o);
				
			tree.unary = unary;
			
			return tree;
		}
		
		
		function excludeSearch(search, range) {
			if (search.i < 0) {
				return;
			} else if (search.i < range.start) {
				search.excludes.push(range);	// FIXME: are those range sorted?
			} else if (search.i < range.end) {
				search.i = range.end;
			}
		}
		
		function selectMatchesForward(matches) {
			var result, tag, i, len;
			for (i = 0, len = o.matches.length; i < len; i++) {
				if (o.matches[i].tag && (!result || o.matches[i].tag.range.start < result.tag.range.start)) {
					result = o.matches[i];
				}
			}
			if (!result) {
				return;
			}
			tag = result.tag;
			result.tag = null;
			return tag;
		}
		
		function treeNext(o) {
			if (o.finished) {
				return {
					finished: true
				};
			}
			
			var i, len;
			for (i = 0, len = o.matches.length; i < len; i++) {
				o.search(o.matches[i]);
			}
			
			var tag = select(), detached, open;
			if (tag) {
				if (tag.type == "open") {
					o.stack.push(tag);
				} else if (tag.type == "close") {
					var t, open;
					while ((t = stack.pop())) {
						if (t.name == tag.name) {
							open = t;
							break;
						}
					}
					if (open) {
						detached = {
							open: open,
							close: tag;
						};
					} else {
						if (o.root) {
							detached = {
								open: o.root,
								close: tag;
							};
						}
						o.finished = true;
					}
				}
			} else {
				o.finished = true;
			}
			
			return {
				tag: tag,
				detached: detached,
				finished: o.finished
			};
		}
		
		function treeExclude(o, range) {
			if (o.root && range.start <= o.root.range.start) {
				o.finished = true;
				return;
			}
			var top;
			while ((top = stack[stack.length - 1])) {
				if (top.range.start >= range.start && top.range.start < range.end) {
					o.stack.pop();
				} else {
					break;
				}
			}
			var i = o.matches.length - 1;
			do {
				o.exclude(o.matches[i], range);
			} while (i--);
		}
			
		function createBackwardMainTree() {
			
		}
		
		function createBackwardTagTree() {
			
		}
		
		function createBackwardSearch() {
			var o = {
				main: createBackwardMainTree,
				tag: createBackwardTagTree
			};
			return createSearch(o);
		}
		
		function createSearch(o) {
			var main = o.main(),
				pool = {},
				names = [];
			
			function exclude(range) {
				main.exclude(range);
				var i = names.length - 1;
				do {
					pool[names[i]].exclude(range);
				} while (i--);
			}
			
			function next() {
				var result;
				
				result = main.next();
				
				if (result.finished) {
					this.finished = true;
					this.tag = result.tag;
					return;
				}
				
				if (result.tag.type == "comment") {
					exclude(result.tag.range);
					
				} else if (result.tag.type == "open" && !pool[result.tag.name]) {
					pool[result.tag.name] = o.tag(result.tag);
					names.push(result.tag.name);
				}
				
				var i = names.length - 1;
				do {
					result = pool[names[i]].next();
					if (result.finished) {
						if (!result.tag) {
							main.unary[trees[i]] = true;
						}
						pool[names[i]] = null;
						names[i] = names[names.length - 1];
						names.pop();
					}
					if (result.detached) {
						exclude({
							result.detached.open.range.start,
							result.detached.close.range.end
						});
					}
				}
			}
			
			return {
				next: next,
				finished: false,
				tag: null
			};
		}
		
		var Search = function(main, tag, cmp){
			this.main = new Tree(main);
		};
		
		function cmpRangeForward(a, b) {
			return a.start - b.start;
		}
		
		function cmpRangeBackward(a, b) {
			return b.end - a.end;
		}
		
		// RangePool, a set of range, which can check if the position is inside or outside of the range pool.
		var RangePool = function(){
			this.ranges = [];
		};
		
		// Add range to set
		RangePool.prototype.add = function(range){
			var i = this.ranges.length - 1;
			do {
				if (this.ranges[i].start < range.start) {
					if (this.ranges[i].end < range.start) {
						this.ranges[i].splice(i + 1, 0, range);
					}
				}
			}
		};
		
		// Check if the pos in the ranges
		RangePool.prototype.has = function(pos){
			
		};
		
		// Match, a data represent with position, match token, tag name.
		var Match = function(ctx, startPos, token, name, excludeName) {
			this.i = startPos;
			this.token = token;
			this.name = name;
			this.excludes = [];
			this.tag = null;
			this.ctx = ctx;
			this.excludeName = excludeName;
		};
		
		Match.prototype.back = function(){
			var tag, ex;
			
			if (this.tag || this.i < 0) {
				return;
			}
			
			ex = this.excludes;
			do {
				this.i = this.ctx.text.lastIndexOf(this.token, this.i);
				if (this.i < 0) {
					break;
				}
				// jump over
				while (ex.length && this.i < ex[0].start) {
					ex.shift();
				}
				// jump to end
				if (ex.length && this.i < ex[0].end) {
					ex.shift();
					this.i = ex[0].start - 1;
					continue;
				}
				tag = matchTag(this.i);
				if (tag) {
					if (
						!tag.selfClose &&
						(!this.name || tag.name == this.name) &&
						(!this.excludeName || !this.excludeName[tag.name])
					) {
						this.tag = tag;
					}
					this.i = tag.range.start - 1;
				} else {
					this.i--;
				}
			} while (!this.tag);
		};
		
		Match.prototype.next = function() {
			var tag, ex;
			
			if (this.tag || this.i < 0) {
				return;
			}
			
			ex = this.excludes;
			do {
				this.i = this.ctx.text.indexOf(this.token, this.i);
				if (this.i < 0) {
					break;
				}
				// jump over
				while (ex.length && ex[0].end <= this.i) {
					ex.shift();
				}
				// jump to end
				if (ex.length && ex[0].start <= this.i) {
					ex.shift();
					this.i = ex[0].end;
					continue;
				}
				tag = matchTag(this.i);
				if (tag) {
					if (
						!tag.selfClose &&
						(!this.name || tag.name == this.name) &&
						(!this.excludeName || !this.excludeName[tag.name])
					) {
						this.tag = tag;
					}
					this.i = tag.range.end;
				} else {
					this.i++;
				}
			} while (!this.tag);
		}
		
		// Tree, a set of matches, iter through tags.
		var Tree = function(matches, root, searchMethod) {
			this.matches = matches;
			this.root = root;
		};
		
		// Normally the search will stop when meeting the match tag.
		Tree.prototype.keepOn = function(){};
		
		Tree.prototype.next = function(){}
			
		function createForwardSearch() {
			var match = new Match(pos, "<");
			var main = new Tree([match]);
			return new SearchTree(main);
			return createSearch({
				main: function(){
					return {
						matches: [{
							i: pos,
							token: "<",
							tag: null,
							excludes: [],
							excludeName: unary
						}]
					};
				},
				tag: function (root) {
					return {
						root: root,
						matches: [{
							token: "<" + root.name,
							i: root.range.end,
							name: root.name
						}, {
							token: "</" + root.name,
							i: root.range.end,
							name: root.name
						}],
						search: searchNext,
					};
				},
				cmpRange: function(a, b) {
					return a.start - b.start;
				}
			});
		}

		return {
			// Main search function
			search: function(){
				var result;
				
				result = this.hit();
				if (!result) {
					result = this.loop();
				}
				
				return result;
			},
			loop: function() {
				var forward = createForwardSearch(),
					backward = createBackwardSearch();
					
				while (!forward.finished && !backward.finished) {
					forward.next();
					backward.next();
				}
				
				while (!forward.finished) {
					forward.next();
				}
				
				if (!forward.tag) {
					return;
				}
				
				if (backward.tag && backward.tag.name != forward.tag.name) {
					backward.tag = null;
					backward.finished = false;
				}
				
				backward.pair = forward.tag;
				
				while (!backward.finished) {
					backward.next();
				}
				
				return [backward.tag, forward.tag];
			},
			// Try to hit comment
			hit: function(){
				var i = text.lastIndexOf("<!--", pos - 1);
				if (i < 0) {
					return;
				}
				tag = matchTag(i);
				if (tag) {
					return [tag, null];
				}
			}
		};
	}

	return {
		_cache: {},
		find: function(html, start_ix) {
			var pair, hash;
			if (this.useCache) {
				hash = "l" + html.length + "p" + start_ix;
				if (this._cache[hash] === undefined) {
					pair = createMatcher(html, start_ix).search();
					this._cache[hash] = makeRange(pair[0], pair[1], start_ix, html);
				}
				return this._cache[hash];
			} else {
				pair = createMatcher(html, start_ix).search();
				return makeRange(pair[0], pair[1], start_ix, html);
			}
		},
		tag: function(html, start_ix) {
			var result = this.find(html, start_ix);
			if (result && result.type == 'tag') {
				return result;
			}
		},
		cache: function(useCache) {
			this.useCache = useCache;
			if (!useCache) {
				this._cache = {};
			}
		},
		// Get context. You only have to search closing tag for parent node.
		ctx: function(){}
	};
});