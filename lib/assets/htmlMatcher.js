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

	var Range = function(start, end) {
		this.start = start;
		this.end = end;
		this.next = null;
		this.prev = null;
	};
	
	Range.prototype.extend = function(range){
		// LeftPair, the right most range that l.start < range.start
		var l = this;
		if (l.start < range.start) {
			while (l.next && l.next.start < range.start) {
				l = l.next;
			}
		} else {
			while (l && l.start >= range.start) {
				l = l.prev;
			}
		}
		// RightPair, the left most range that r.end > range.end
		var r = this;
		if (r.end > range.end) {
			while (r.prev && r.prev.end > range.end) {
				r = r.prev;
			}
		} else {
			while (r && r.end <= range.end) {
				r = r.next;
			}
		}
		
		var c, n;
		
		if (!l) {
			if (!r) {
				// cover all ranges
				// to right
				c = this.next;
				while (c) {
					n = c.next;
					c.prev = range;
					c.next = range;
					c = n;
				}
				// to left
				c = this.prev;
				while (c) {
					n = c.prev;
					c.prev = range;
					c.next = range;
					c = n;
				}
				// self
				this.prev = range;
				this.next = range;
			} else {
				// cover from r.prev to left
				// to left
				c = r.prev;
				while (c) {
					n = c.prev;
					c.prev = range;
					c.next = range;
					c = n;
				}
				// r
				r.prev = range;
				range.next = r;
			}
		} else {
			if (!r) {
				// cover from l.next to right
				c = l.next;
				while (c) {
					n = c.next;
					c.prev = range;
					c.next = range;
					c = n;
				}
				// l
				l.next = range;
				range.prev = l;
			} else {
				if (l == r) {
					// inside l (r)
					range.prev = l;
					range.next = l;
				} else {
					// cover from l.next to r.prev
					c = l.next;
					while (c != r) {
						n = c.next;
						c.prev = range;
						c.next = range;
						c = n;
					}
					// insert between l, r
					l.next = range;
					range.prev = l;
					range.next = r;
					r.prev = range;
				}
			}
		}
		
		return range;
	};
			
	// Match, a data represent with position, match token, tag name.
	var Match = function(text, startPos, token, name, excludeRange) {
		this.text = text;
		this.i = startPos;
		this.token = token;
		this.name = name;
		this.excludeRange = excludeRange;
		this.tag = null;
	};
	
	Match.prototype.back = function(){
		var tag, ex;
		
		if (this.tag || this.i < 0) {
			return;
		}
		
		ex = this.excludeRange;
		do {
			this.i = this.text.lastIndexOf(this.token, this.i);
			if (this.i < 0) {
				return;
			}
			// jump over
			while (ex.prev && ex.prev.end > this.i) {
				ex = ex.prev;
			}
			this.excludeRange = ex;
			// jump to end
			if (ex.start <= this.i && ex.end > this.i) {
				this.i = ex.start - 1;
				continue;
			}
			tag = matchTag(this.i, this.text);
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
		
		console.log(-1, this.tag.name);
	};
	
	Match.prototype.next = function() {
		var tag, ex;
		
		if (this.tag || this.i < 0) {
			return;
		}
		
		ex = this.excludeRange;
		do {
			this.i = this.text.indexOf(this.token, this.i);
			if (this.i < 0) {
				return;
			}
			// jump over
			while (ex.next && ex.next.start <= this.i) {
				ex = ex.next;
			}
			this.excludeRange = ex;
			// jump to end
			if (ex.start <= this.i && ex.end > this.i) {
				this.i = ex.end;
				continue;
			}
			tag = matchTag(this.i, this.text);
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
		
		console.log(1, this.tag.name);
	};
	
	Match.prototype.addExclude = function(range){
		this.excludeRange.extend(range);
	};
	
	// Get first match from group of matches
	var MatchGroup = function(matches){
		this.matches = matches;
	};
	
	MatchGroup.prototype.next = function(){
		var i, len = this.matches.length;
		for (i = 0; i < len; i++) {
			this.matches[i].next();
		}
		var result;
		for (i = 0; i < len; i++) {
			if (this.matches[i].tag && (!result ||  this.matches[i].tag.range.start < result.tag.range.start)) {
				result = this.matches[i];
			}
		}
		if (!result) {
			return;
		}
		var tag = result.tag;
		result.tag = null;
		return tag;
	};
	
	MatchGroup.prototype.back = function(){
		var i, len = this.matches.length;
		for (i = 0; i < len; i++) {
			this.matches[i].back();
		}
		var result;
		for (i = 0; i < len; i++) {
			if (this.matches[i].tag && (!result ||  this.matches[i].tag.range.end > result.tag.range.end)) {
				result = this.matches[i];
			}
		}
		if (!result) {
			return;
		}
		var tag = result.tag;
		result.tag = null;
		return tag;
	};
	
	// Add exclude range?
	MatchGroup.prototype.exclude = function(){
		this.matches[0].excludeRange.extend();
	};
	
	// A pair of tag
	var TagPair = function(open, close) {
		this.open = open;
		this.close = close;
	};
	
	// The result of tree.next
	var TreeResult = function(tag, detached, finished){
		this.tag = tag;
		this.detached = detached;
		this.finished = finished;
	};
	
	TreeResult.finished = new TreeResult(null, null, true);
	
	// Tree, a set of matches, iter through tags.
	var Tree = function(matchGroup, direction, root) {
		this.matchGroup = matchGroup;
		this.root = root;
		this.stack = [];
		this.direction = direction;
		this.finished = false;
		
		if (direction == "next") {
			this.openType = "open";
			this.closeHandle = this.handleNextClose;
		} else {
			this.openType = "close";
			this.closeHandle = this.handleBackOpen;
		}
	};
	
	Tree.prototype.handleNextClose = function(tag) {
		var open;
		while (this.stack.length) {
			open = this.stack.pop();
			// paired
			if (open.name == tag.name) {
				return new TreeResult(tag, new TagPair(open, tag), false);
			}
		}
		// no pair, no root, found
		if (!this.root) {
			this.finished = true;
			return new TreeResult(tag, null, true);
		}
		// paired with root
		if (this.root.name == tag.name) {
			this.finished = true;
			return new TreeResult(tag, new TagPair(this.root, tag), true);
		}
		// can't pair root?
		this.finised = true;
		return new TreeResult(tag, null, true);
	};
	
	Tree.prototype.handleBackOpen = function(tag) {
		var len = this.stack.length;
		if (!len) {
			// Pending
			if (!this.root) {
				this.finished = true;
				return new TreeResult(tag, null, true);
			}
			// Found
			if (tag.name == this.root.name) {
				this.finished = true;
				return new TreeResult(tag, new TagPair(tag, this.root), true);
			}
			// Unary open tag
			return new TreeResult(tag, null, false);
		}
		if (this.stack[len - 1].name == tag.name) {
			// paired
			return new TreeResult(tag, new TagPair(tag, this.stack.pop()), false);
		}
		// Unary open
		return new TreeResult(tag, null, false);
	};
	
	// Reset finished flag and keep searching.
	Tree.prototype.keepOn = function(){
		this.finished = false;
	};
	
	// Get a tag
	Tree.prototype.next = function(){
		if (this.finished) {
			return TreeResult.finished;
		}
		
		var tag = this.matchGroup[this.direction]();
		
		if (!tag) {
			this.finished = true;
			return TreeResult.finished;
		}
		
		if (tag.type == this.openType) {
			this.stack.push(tag);
			return new TreeResult(tag, null, false);
		} else {
			return this.closeHandle(tag);
		}			
	};
	
	// Remove node that is excluded
	Tree.prototype.stackExclude = function(range) {
		if (this.root && this.root.range.start >= range.start && this.root.range.end <= range.end) {
			this.finished = true;
			return;
		}
		var i = this.stack.length, tag;
		while (i) {
			tag = this.stack[i - 1];
			if (tag.range.start >= range.end || tag.range.end <= range.start) {
				break;
			}
			this.stack.pop();
			i--;
		}
	};
	
	Tree.prototype.getExclude = function() {
		return this.matchGroup.matches[0].excludeRange;
	};
	
	var Search = function(text, i, direction, excludeRange){
		this.text = text;
		this.direction = direction;
		this.excludeRange = excludeRange;
		this.finished = false;
		this.tag = null;
		this.trees = [];
		this.pool = {};
		this.explicit = null;
		this.explicitPending = null;
		this.explicitWeak = null;
		this.main = new Tree(
			new MatchGroup([
				new Match(text, i, "<", null, excludeRange)
			]),
			direction,
			null
		);
		if (direction == "next") {
			this.openType = "open";
			this.createTree = this.createTreeNext;
		} else {
			this.openType = "close";
			this.createTree = this.createTreeBack;
		}
	};
		
	Search.prototype.createTreeNext = function(tag, i){
		if (i == null) {
			i = tag.range.end;
		}
		this.excludeRange = this.main.getExclude();
		return new Tree(
			new MatchGroup([
				new Match(this.text, i, "<" + tag.name, tag.name, this.excludeRange),
				new Match(this.text, i, "</" + tag.name, tag.name, this.excludeRange)
			]),
			this.direction,
			tag
		);
	};
	
	Search.prototype.createTreeBack = function(tag, i) {
		if (i == null) {
			i = tag.range.start - 1;
		}
		this.excludeRange = this.main.getExclude();
		return new Tree(
			new MatchGroup([
				new Match(this.text, i, "<" + tag.name, tag.name, this.excludeRange),
				new Match(this.text, i, "</" + tag.name, tag.name, this.excludeRange)
			]),
			this.direction,
			tag
		);
	};
	
	Search.prototype.next = function(){
		var result, range;
		
		console.log(this.direction);
		
		if (this.explicit && !this.explicitPending) {
			console.log("explicit");
			result = this.explicit.next();
			if (result.finished) {
				if (result.tag) {
					this.finished = true;
					this.tag = result.tag;
					return;
				} else if (this.explicitWeak) {
					// wrong explicit
					this.pool[this.explicit.root.name] = null;
					this.explicit = null;
					this.main.root = null;
				} else {
					// can't find
					this.finished = true;
					return;
				}
			}
			if (result.detached) {
				range = new Range(
					result.detached.open.range.start,
					result.detached.close.range.end
				);
				this.explicit.matchGroup.matches[0].excludeRange.extend(range);
				this.cleanTreeStack(range);
			}
		}
		
		console.log("main");
		result = this.main.next();
		
		if (result.finished) {
			this.finished = true;
			this.tag = result.tag;
			return;
		}
		
		if (result.tag.type == this.openType && !this.pool[result.tag.name]) {
			this.pool[result.tag.name] = this.createTree(result.tag);
			this.trees.push(result.tag.name);
		}
		
		console.log("trees");
		var i = this.trees.length, name;
		while (i) {
			name = this.trees[i - 1];
			result = this.pool[name].next();
			if (result.detached) {
				range = new Range(
					result.detached.open.range.start,
					result.detached.close.range.end
				);
				this.pool[name].matchGroup.matches[0].excludeRange.extend(range);
				this.cleanTreeStack(range);
			}
			i--;
		}
		
		// remove finished trees
		i = this.trees.length;
		while (i) {
			if (this.pool[this.trees[i - 1]].finished) {
				this.pool[this.trees[i - 1]] = null;
				this.trees[i - 1] = this.trees[this.trees.length - 1];
				this.trees.pop();
			}
			i--;
		}
		
		if (this.explicitPending && this.explicitPending.finished) {
			this.pool[this.explicitPending.root.name] = true;
			this.explicitPending = null;
		}
	};
	
	Search.prototype.cleanTreeStack = function(range) {
		this.main.stackExclude(range);
		if (this.explicit) {
			this.explicit.stackExclude(range);
		}
		
		var i, len;
		for (i = 0, len = this.trees.length; i < len; i++) {
			this.pool[this.trees[i]].stackExclude(range);
		}
	};
	
	Search.prototype.keepMatchingPair = function(tag, weak) {
		this.tag = null;
		this.finished = false;
		this.main.finished = false;
		this.main.root = tag;
		this.explicit = this.createTree(tag, this.main.matchGroup.matches[0].i);
		this.explicitWeak = weak;
		if (this.pool[tag.name]) {
			console.log("pending");
			this.explicitPending = this.pool[tag.name];
		} else {
			this.pool[tag.name] = true;
		}
	};
		
	function matchTag(pos, text) {
		var match;
		if (text[pos + 1] == "/") {
			// close
			if ((match = text.substr(pos).match(end_tag))) {
				return tag(match, pos, "close");
			}
		} else if (text[pos + 1] == "!" && text[pos + 2] == "-" && text[pos + 3] == "-") {
			// comment
			if ((match = text.indexOf("-->", pos + 4)) >= 0) {
				return comment(pos, match + 3);
			}
		} else if ((match = text.substr(pos).match(start_tag))) {
			// open
			return tag(match, pos, "open");
		}
	}
	
	function createMatcher(text, pos) {
		var excludeRange;
		
		function buildExclude(i, j) {
			var range = excludeRange = new Range(pos, pos);
			while ((i = text.indexOf("<!--", i)) >= 0 && i < j) {
				var tag = matchTag(i, text);
				if (!tag) {
					i++;
				} else {
					i = tag.range.end;
					range = range.extend(new Range(
						tag.range.start,
						tag.range.end
					));
				}
			}
		}
		
		return {
			// Main search function
			search: function(){
				var tag;
				
				tag = this.hit();				
				if (tag) {
					console.log("hit");
					if (tag.type == "comment" || tag.selfClose) {
						return [tag, null];
					} else if (tag.type == "open") {
						buildExclude(tag.range.end, text.length);
						return this.forward(tag);
					} else {
						buildExclude(0, tag.range.start);
						return this.backward(tag);
					}
				} else {
					console.log("no hit");
					buildExclude(0, text.length);
					return this.loop();
				}
			},
			backward: function(close){
				var backward = new Search(text, close.range.start - 1, "back", excludeRange);
				
				backward.keepMatchingPair(close);
				
				while (!backward.finished) {
					backward.next();
				}
				
				return [backward.tag, close];
			},
			forward: function(open){
				var forward = new Search(text, open.range.end, "next", excludeRange);
				
				forward.keepMatchingPair(open);
				
				while (!forward.finished) {
					forward.next();
				}
				
				return [open, forward.tag];
			},
			loop: function() {
				var forward = new Search(text, pos, "next", excludeRange),
					backward = new Search(text, pos - 1, "back", excludeRange);
					
				while (!forward.finished && !backward.finished) {
					forward.next();
					backward.next();
				}
				
				if (backward.tag && !forward.finished) {
					forward.keepMatchingPair(backward.tag, true);
				}
				
				while (!forward.finished) {
					forward.next();
				}
				
				if (!forward.tag) {
					return;
				}
				
				if (!backward.tag || backward.tag.name != forward.tag.name) {
					backward.keepMatchingPair(forward.tag);
				}
				
				while (!backward.finished) {
					backward.next();
				}
				
				return [backward.tag, forward.tag];
			},
			hit: function(){
				// Try to hit comment
				var i = text.lastIndexOf("<!--", pos - 1), tag;
				if (i >= 0) {
					tag = matchTag(i, text);
					if (tag && tag.range.end > pos) {
						return tag;
					}
				}
				// hit tag
				i = pos - 1;
				while ((i = text.lastIndexOf("<", i)) >= 0) {
					tag = matchTag(i, text);
					if (!tag) {
						i--;
					} else {
						if (tag.range.end > pos) {
							return tag;
						}
						break;
					}
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
					if (pair) {
						this._cache[hash] = makeRange(pair[0], pair[1], start_ix, html);
					}
				}
				return this._cache[hash];
			} else {
				pair = createMatcher(html, start_ix).search();
				if (pair) {
					return makeRange(pair[0], pair[1], start_ix, html);
				}
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