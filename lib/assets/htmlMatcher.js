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
		return  {
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
		
		function searchNext(token, pos) {
			var match = pos, tag;
			while (true) {
				match = text.indexOf(token, match);
				if (match < 0) {
					return;
				}
				tag = matchTag(match);
				if (tag && tag.id == token && !tag.selfClose) {
					return tag;
				}
				match++;
			}
		}
		
		record = {};
		function quickMatchOpen(tag) {
			var tokenOpen = "<" + tag.name,
				tokenClose = "</" + tag.name;
				
			if (!(record[tokenOpen] > tag.range.end)) {
				record[tokenOpen] = tag.range.start;
			}
			
			if (!(record[tokenClose] > tag.range.end)) {
				record[tokenClose] = tag.range.start;
			}
			
			var open = searchNext(tokenOpen, record[tokenOpen] + 1),
				close = searchNext(tokenClose, record[tokenClose] + 1);
				
			if (!close) {
				return -1;
			}
			
			if (!open || close.range.start < open.range.start) {
				return close;
			}
			
			record[tokenOpen] = open.range.start;
			record[tokenClose] = close.range.start;
		}

		var quickMatchPool = {},
			quickMatchList = [];
			
		var unary = {};
		
		function closeQuickMatch(open, close) {
			var i;
			for (i = 0; i < quickMatchList.length; i++) {
				tag = quickMatchPool[quickMatchList[i]];
				if (tag.range.start > open.range.start) {
					quickMatchList[i] = quickMatchList[quickMatchList.length - 1];
					quickMatchList.pop();
					i--;
					quickMatchPool[tag.name] = undefined;
				} else {
					var tagOpenToken = "<" + tag.name;						
					if (record[tagOpenToken] < close.range.start) {
						var tagCloseToken = "</" + tag.name;
						record[tagOpenToken] = close.range.end;
						record[tagCloseToken] = close.range.end;
					}
				}
			}
		}
			
		function searchQuickMatch() {
			var i, tag, close;
			for (i = 0; i < quickMatchList.length; i++) {
				tag = quickMatchPool[quickMatchList[i]];
				close = quickMatchOpen(tag);
				if (close == -1) {
					unary[tag.name] = true;
					quickMatchList[i] = quickMatchList[quickMatchList.length - 1];
					quickMatchList.pop();
					i--;
					quickMatchPool[tag.name] = undefined;
				} else if (close) {
					iF = close.range.end;
					while (stackF.length) {
						if (stackF.pop() == tag) {
							break;
						}
					}
					closeQuickMatch(tag, close);
					// always do another search after moving i. so the quick match can handle the close tag before i.
					searchQuickMatch();
					break;
				}
			}
		}
		
		var handleF = {
			"open": function(tag){
				if (tag.selfClose || tag.type == "comment" || unary[tag.name]) {
					return;
				}
				stackF.push(tag);
				if (!quickMatchPool[tag.name]) {
					quickMatchPool[tag.name] = tag;
					quickMatchList.push(tag.name);
				}
				searchQuickMatch();
			},
			"close": function(tag) {
				// all the close tag should be handled by quick match.
				foundF = tag;
				if (foundB && foundB.name != foundF.name && !hit) {
					foundB = null;
				}
			}
		};

		var handleB = {
			"close": function(tag) {
				stackB.push(tag);
			},
			"open": function(tag) {
				if (tag.selfClose) {
					return;
				}
				if (stackB.length) {
					if (stackB[stackB.length - 1].name == tag.name) {
						stackB.pop();
					}
					return;
				}
				if (!foundF || foundF.name == tag.name) {
					foundB = tag;
				}
			},
			"comment": function(tag) {
				// Since comment may contain tags, it might be hit after first try
				if (tag.range.end > pos) {
					foundB = tag;
					hit = true;
				}
			}
		};

		var handleH = {
			"open": function(tag) {
				foundB = tag;
				hit = true;
			},
			"close": function(tag) {
				foundF = tag;
				hit = true;
			},
			"comment": function(tag) {
				foundB = tag;
				hit = true;
			}
		};

		function backward(){
			if (iB < 0) {
				endB = true;
				return;
			}
			if ((iB = text.lastIndexOf("<", iB)) >= 0) {
				var tag = matchTag(iB);
				iB -= 3;	// next search point (<b>)
				return tag;
			}
			endB = true;
		}

		function forward(){
			if (iF < 0) {
				endF = true;
				return;
			}
			if ((iF = text.indexOf("<", iF)) >= 0) {
				var tag = matchTag(iF);
				iF = tag ? tag.range.end : iF + 1;
				return tag;
			}
			endF = true;
		}
		
		function createForwardMainTree() {
			var unary = {},
				search = {
					i: pos,
					token: "<",
					tag: null,
					excludes: [],
					excludeName: unary
				},
				o = {
					stack: [],
					finished: false,
					matches: [search]
				},
				tree = createTree(o);
				
			tree.unary = unary;
			
			return tree;
		}
		
		function searchNext(search) {
			var tag, ex = search.excludes;
			if (!search.tag && search.i >= 0) {
				do {
					search.i = text.indexOf(search.token, search.i);
					if (search.i < 0) {
						break;
					}
					// jump over
					while (ex.length && ex[0].end <= i) {
						ex.shift();
					}
					// jump to end
					if (ex.length && ex[0].start <= i) {
						i = ex[0].end;
						continue;
					}
					tag = matchTag(search.i);
					if (tag) {
						if (
							!tag.selfClose &&
							(!search.name || tag.name == search.name) &&
							(!search.excludeName || !search.excludeName[tag.name])
						) {
							search.tag = tag;
						}
						i = tag.range.end;
					} else {
						i++;
					}
				} while (!search.tag);
			}
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
		
		function createTree(o) {
			function select() {
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
			
			function stackPop(tag) {
				var top;
				while ((top = stack.pop())) {
					if (top.name == tag.name) {
						return top;
					}
				}
			}
			
			function next() {
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
						if ((open = stackPop(tag))) {
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
			
			function exclude(range) {
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
			
			return {
				next: next,
				exclude: exclude
			};
		}
		
		function createForwardTagTree(root) {
			var open = {
					tag: null,
					token: "<" + root.name,
					i: root.range.end,
					name: root.name,
					excludes: []
				},
				close = {
					tag: null,
					token: "</" + root.name,
					i: root.range.end,
					name: root.name,
					excludes: []
				},
				o = {
					root: root,
					stack: [],
					finished: false,
					matches: [open, close],
					search: searchNext,
					exclude: excludeSearch
				};
				
			return createTree(o);
		}
		
		function createForwardSearch() {
			var mainTree = createForwardMainTree(),
				treePool = {},
				trees = [];
				
			function excludeSearchRange(range) {
				mainTree.exclude(range);
				var i;
				for (i = 0; i < trees.length; i++) {
					treePool[trees[i]].exclude(range);
				}
			}
			
			function normalizeTrees() {
				var i;
				for (i = 0; i < trees.length; i++) {
					if (trees[i] == null) {
						trees[i] = trees[trees.length - 1];
						trees.pop();
						i--;
					}
				}
			}

			return {
				next: function() {
					var result;
					
					result = mainTree.next();
					
					if (result.finished) {
						this.finished = true;
						return;
					}
					
					if (result.tag.type == "close") {
						this.tag = result.tag;
						
					} else if (result.tag.type == "comment") {
						excludeSearchRange(result.tag.range);
						
					} else if (!treePool[result.tag.name]) {
						treePool[result.tag.name] = createForwardTagTree(result.tag);
						trees.push(result.tag.name);
					}
					
					var i;
					for (i = 0; i < trees.length; i++) {
						result = treePool[trees[i]].next();
						if (result.finished) {
							if (!result.tag) {
								mainTree.unary[trees[i]] = true;
							}
							treePool[trees[i]] = null;
							trees[i] = null;
						}
						if (result.detached) {
							excludeSearchRange({
								result.detached.open.range.start,
								result.detached.close.range.end
							});
						}
					}
					
					normalizeTrees();
				},
				finished: false,
				tag: null
			};
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