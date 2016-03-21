# Emmet — the essential toolkit for web-developers

[![Get Support](http://codersclan.net/graphics/getSupport_github4.png)](http://codersclan.net/support/step1.php?repo_id=4)

Emmet (formerly *Zen Coding*) is a web-developer’s toolkit that can greatly improve your HTML & CSS workflow.

With Emmet, you can type CSS-like expressions that can be dynamically parsed, and produce output depending on what you type in the abbreviation. Emmet is developed and optimised for web-developers whose workflow depends on HTML/XML and CSS, but can be used with programming languages too.

For example, this abbreviation:

    ul#nav>li.item$*4>a{Item $}

...can be expanded into:

	<ul id="nav">
		<li class="item1"><a href="">Item 1</a></li>
		<li class="item2"><a href="">Item 2</a></li>
		<li class="item3"><a href="">Item 3</a></li>
		<li class="item4"><a href="">Item 4</a></li>
	</ul>

[Learn more about Emmet features](http://docs.emmet.io)

## jsPerf References

https://jsperf.com/charat-vs-index/2
https://jsperf.com/if-switch-lookup-table/10
https://jsperf.com/fastest-array-loops-in-javascript/233

## Algorithm

### Basic

Use stack to flatten it.

```
search any
if type is close:
	found
if type is open:
	find close
	start search from close
		
find close (open):
	search any
	if type is close
		return close
	if type is open
		find close
		start search from close
```

### Quick search

Maintain one DOM Tree, multiple Tag Tree. The DOM Tree can be constructed with basic algorithm. The Tag Tree can be constructed with Quick Match, which will search its own tag name with indexOf.

If a tree or sub tree is completely built (i.e. meeting a close tag), it can be removed from tree. When a tree is removed, it should tell other trees that it is removed so other trees can adjust their searching range.

```
createMatcher().search()

matcher.search():
	result = this.hit()
	if not result:
		result = this.loop()
	return makeRange(result)
	
matcher.hit():
	// Try to hit comment
	i = text.lastIndexOf("<!--", pos - 1)
	if i < 0:
		return
		
	tag = matchTag(i)
	if not tag:
		return
		
	return [tag, null]

matcher.loop():
	this.forward = createForwardSearch(pos)
	this.backward = createBackwardSearch(pos - 1)

	while not this.forward.finished and not this.backward.finished:
		this.forward.next()
		this.backward.next()
				
	while not this.forward.finished:
		this.forward.next()
		
	if not this.forward.tag:
		return
		
	this.backward.paired = this.forward.tag
	
	if this.backward.tag and this.forward.tag.name != this.backward.tag.name:
		this.backward.finished = False
		this.backward.tag = None
		
	while not this.backward.finished:
		this.backward.next()
		
	return [this.backward.tag, this.forward.tag]
	
forward.next():
	result = this.domTree.next()
	if result.unPaired:
		this.tag = result.tag
		this.finished = true
		return this.tag
		
	if result.tag.type == "comment":
		this.excludeSearchRange(result.tag.range)
		
	elif result.tag.name not in this.tagTreePool and result.tag.type == "open":
		this.tagTreePool.add(createTagTree(tag))
		
	for tree in this.tagPool:
		result = tree.next()
		if result.detachedTree:
			this.excludeSearchRange({
				start: result.detachedTree.open.range.start,
				end: result.detachedTree.close.range.end
			})
			
	this.removeFinishedTagTree()
```
