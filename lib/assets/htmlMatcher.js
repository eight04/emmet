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
	// 1=id, 2=name, 3=attributes, 4=closeSelf
	var start_tag = /^(<([\w\:\-]+))((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/,
		start_tag_g = /<([\w\:\-]+)((?:\s+[\w\-:]+(?:\s*=\s*(?:(?:"[^"]*")|(?:'[^']*')|[^>\s]+))?)*)\s*(\/?)>/g,
		// 1=id, 2=name
		end_tag = /^(<\/([\w\:\-]+))[^>]*>/,
		end_tag_g = /<\/([\w\:\-]+)[^>]*>/g;

	function tag(match, ix, type) {
		return  {
			full: match[0],
			id: match[1],
			name: match[2].toLowerCase(),
			type: type,
			selfClose: !!match[4],
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
		var foundB, foundF,
			hit;

		function matchTag(pos) {
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
				} else {
					return -1;	// unfound
				}
			} else if ((match = text.substr(pos).match(start_tag))) {
				// open
				return tag(match, pos, "open");
			}
		}

		var mark = {};
		function searchBack(token, pos) {
			if (pos < 0) {
				return -1;
			}
			var match = text.lastIndexOf(token, pos);
			if (match < 0) {
				return -1;
			}
			if (!mark[token]) {
				mark[token] = {};
			}
			if (mark[token][match] === undefined) {
				mark[token][match] = match;
				var tag = matchTag(match);
				if (tag && !tag.selfClose && tag.id == token) {
					// console.log(-1, tag.id);
					return match;
				}
			}
			mark[token][match] = searchBack(token, mark[token][match] - 1);
			return mark[token][match];
		}

		function searchNext(token, pos) {
			var match = pos;
			while ((match = text.indexOf(token, match)) >= 0) {
				var tag = matchTag(match);
				if (tag && tag.id == token) {
					// console.log(1, tag.id);
					return match;
				}
				match++;
			}
			return -1;
		}

		function searchPrevPair(name, pos) {
			var open = "<" + name,
				close = "</" + name;

			if (!mark[close]) {
				mark[close] = {};
			}

			var match = searchBack(open, pos);
			if (match >= 0) {
				mark[close][pos] = match;
			}
			return match;
		}

		function searchNextPair(name, pos) {
			var open = "<" + name,
				close = "</" + name,
				iO, iC;

			if (!mark[open]) {
				mark[open] = {};
			}
			if (!mark[close]) {
				mark[close] = {};
			}

			iO = iC = pos + 1;

			while (true) {
				iO = searchNext(open, iO);
				iC = searchNext(close, iC);

				if (iC < 0) {
					// no pair. the close tag is omitted. mark it
					mark[open][pos] = pos;
					return -1;
				}

				if (iO < 0 || iO > iC) {
					// paired. mark them
					mark[close][iC] = pos;
					mark[open][pos] = pos;
					return iC;
				}

				// paired inside. mark them
				mark[close][iC] = iO;
				mark[open][iO] = iO;
				iO++;
				iC++;
			}
		}

		function searchBackAny(pos) {
			var match = pos, tag;
			while (match >= 0) {
				match = text.lastIndexOf("<", match);
				if (match < 0) {
					return null;
				}
				tag = matchTag(match);
				if (tag) {
					return tag;
				}
				match--;
			}
		}

		return {
			// Main search function
			search: function(){
				this.hit();

				// console.log("hit", !!hit);

				if (foundB && (foundB.type == "comment" || foundB.selfClose)) {
					return this.result();
				}

				if (!foundF) {
					this.searchForward();
				} else {
					this.searchBackward();
				}

				return this.result();
			},
			// The pos is in open tag.
			hit: function(){
				// Try to hit comment
				var match, tag;
				match = text.lastIndexOf("<!--", pos - 1);
				if (match >= 0) {
					tag = matchTag(match);
					if (tag && tag.range.end > pos) {
						foundB = tag;
						hit = true;
						return;
					}
				}

				tag = searchBackAny(pos - 1);
				if (tag && tag.range.end > pos) {
					if (tag.type == "open") {
						foundB = tag;
					} else {
						foundF = tag;
					}
					hit = true;
					return;
				}
			},
			// Forward search for end tag.
			searchForward: function(){
				if (hit) {
					var pair = searchNextPair(foundB.name, foundB.range.start);

					if (pair >= 0) {
						foundF = matchTag(pair);
					}
				} else {
					end_tag_g.lastIndex = pos;
					start_tag_g.lastIndex = pos;

					// look for end tag
					while (true) {
						var matchOpen = start_tag_g.exec(text),
							matchClose = end_tag_g.exec(text);

						if (!matchClose) {
							return;
						}

						if (!matchOpen || matchOpen.index > matchClose.index) {
							// Found close
							foundF = matchTag(matchClose.index);
							this.searchBackward();
							return;
						}

						// try to pair close tag
						var iO = searchPrevPair(matchClose[1], matchClose.index);
						if (iO < pos) {
							// it contains cursor. found
							foundF = matchTag(matchClose.index);
							mark["<" + matchClose[1]][iO] = undefined;
							this.searchBackward();
							return;
						}

						// try to pair open tag
						var iC = searchNextPair(matchOpen[1], matchOpen.index);
						if (iC >= 0) {
							// paired. skip this section
							start_tag_g.lastIndex = iC + 1;
							// if close tag is in this section, skip that too.
							if (matchClose.index < iC) {
								end_tag_g.lastIndex = iC + 1;
							}
						}
					}
				}
			},
			// Backward search for open tag. Must match foundF.
			searchBackward: function(){
				var open = "<" + foundF.name,
					close = "</" + foundF.name,
					matchOpen, matchClose;

				matchOpen = foundF.range.start - 1;
				matchClose = foundF.range.start - 1;
				while ((matchOpen = searchBack(open, matchOpen)) >= 0) {
					matchClose = searchBack(close, matchClose);
					if (matchClose < matchOpen) {
						foundB = matchTag(matchOpen);
						return;
					}
				}
			},
			result: function(){
				// console.log(foundB && foundB.full, foundF && foundF.full);
				if (foundB && foundF && foundB.name != foundF.name) {
					if (hit) {
						foundF = null;
					}
				}
				return [foundB, foundF];
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