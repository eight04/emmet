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
				} else {
					return -1;	// unfound
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
			var i = pos,
				stack = [],
				excludes = [];
			
			return {
				next: function(){
					var tag, pair = false;
					do {
						i = text.indexOf("<", i);
						if (i < 0) {
							break;
						}
						if (excludes.length && i >= excludes[0].start) {
							i = excludes[0].end;
							excludes.pop();
						}
						tag = matchTag(i);
						if (tag) {
							if (tag.type == "open" && !tag.selfClose) {
								stack.push(tag);
							} else if (tag.type == "close") {
								while (stack.length) {
									if (stack.pop().name == tag.name) {
										pair = true;
										break;
									}
								}
							}
							i = tag.range.end;
						} else {
							i++;
						}
					} while (!tag);
					
					return {
						tag: tag,
						nofound: i < 0,
						pair: pair
					};
				},
				exclude: function(range){
					if (i < range.start) {
						excludes.push(range);
						return;
					}
					if (i < range.end) {
						i = range.end;
						while (stack.length && stack[stack.length - 1].range.start >= range.start && stack[stack.length - 1].range.end <= range.end) {
							stack.pop();
						}
					}
				}
			};
		}
		
		function createForwardTagTree(tag) {
			
			
			return {
				next: function(){},
				exclude: function(){}
			};
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

			return {
				next: function() {
					var result;
					
					result = mainTree.next();
					if (result.nofound) {
						this.finished = true;
						return;
					}
					if (result.tag.type == "close" && !result.pair) {
						this.tag = result.tag;
						this.finished = true;
						return;
					}
					if (result.tag.type == "comment") {
						excludeSearchRange(result.tag.range);
					} else if (!treePool[result.tag.name]/* && result.tag.type == "open"*/) {
						// if type == "close", the tag should be always in tree pool
						treePool[result.tag.name] = createForwardTagTree(result.tag);
						trees.push(result.tag.name);
					}
					
					var i;
					for (i = 0; i < trees.length; i++) {
						result = treePool[trees[i]].next();
						if (result.detachedTree) {
							if (result.finished) {
								treePool[trees[i]] = null;
								trees[i] = trees[trees.length - 1];
								trees.pop();
								i--;
							}
							excludeSearchRange({
								result.detachedTree.open.range.start,
								result.detachedTree.close.range.end
							});							
						}
					}
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

				// if (foundB && (foundB.type == "comment" || foundB.selfClose)) {
					// return this.result();
				// }

				// while ((!foundF || !foundB) && !endF && !endB) {
					// if (!foundF && !foundB) {
						// this.searchBoth();
					// } else if (!foundF) {
						// this.searchForward();
					// } else {
						// this.searchBackward();
					// }
				// }

				// return this.result();
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
			},
			// Forward search for end tag.
			// searchForward: function(){
				// var match;
				// while (!endF && !foundF) {
					// match = forward();

					// if (!match) {
						// continue;
					// }

					// if (handleF[match.type]) {
						// handleF[match.type](match);
					// }
				// }
			// },
			// Backward search for open tag. Must match foundF.
			// searchBackward: function(){
				// var match;
				// while (!endB && !foundB) {
					// match = backward();

					// if (!match) {
						// continue;
					// }

					// if (handleB[match.type]) {
						// handleB[match.type](match);
					// }
				// }
			// },
			// Search both way until find something ot meeting end. This method should make it faster to hit the edge at the top or bottom of the document.
			// searchBoth: function(){
				// var matchF, matchB;
				// while (!foundF && !foundB && !endF && !endB) {
					// matchF = forward();
					// if (matchF && handleF[matchF.type]) {
						// handleF[matchF.type](matchF);
					// }

					// matchB = backward();
					// if (matchB && handleB[matchB.type]) {
						// handleB[matchB.type](matchB);
					// }
				// }
			// },
			// result: function(){
				// if (foundB && foundF && foundB.name != foundF.name) {
					// if (hit) {
						// foundF = null;
					// }
				// }
				// return [foundB, foundF];
			// }
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