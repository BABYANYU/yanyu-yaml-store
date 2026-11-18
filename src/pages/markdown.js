import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import { toString } from "mdast-util-to-string"

import { VFileMessage } from "vfile-message"
import { escapeHtml } from "../common.js"
import typographyCss from "../../frontend/typography.css"

const descriptionLimit = 200
const defaultTitle = "Untitled"

export function sanitizeMarkdownUrls() {
  return (tree) => {
    const nodes = [tree]
    while (nodes.length) {
      const node = nodes.pop()
      if (node.type === 'element' && node.properties) {
        const property = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : null
        if (property && property in node.properties) {
          const value = node.properties[property]
          // Reject controls instead of allowing browser URL normalization to hide a scheme.
          let allowed = typeof value === 'string' && !/[\u0000-\u0020\u007f-\u009f]/.test(value)
          if (allowed) {
            try {
              const protocol = new URL(value, 'https://markdown.invalid/').protocol
              allowed = protocol === 'https:' || protocol === 'http:' ||
                (node.tagName === 'a' && protocol === 'mailto:')
            } catch {
              allowed = false
            }
          }
          if (!allowed) delete node.properties[property]
        }
      }
      if (node.children) {
        for (const child of node.children) nodes.push(child)
      }
    }
  }
}

function getMetadata(options) {
  return (tree) => {
    if (tree.children.length === 0) return

    const firstChild = tree.children[0]
    // if the document begins with a h1, set its content as the title
    if (firstChild.type === "heading" && firstChild.depth === 1) {
      options.result.title = escapeHtml(toString(firstChild))

      if (tree.children.length > 1) {
        // description is set as the content of the second node
        const secondChild = tree.children[1]
        options.result.description = escapeHtml(toString(secondChild).slice(0, descriptionLimit))
      }
    } else {
      // no title is set
      // description is set as the content of the first node
      options.result.description = escapeHtml(toString(firstChild).slice(0, descriptionLimit))
    }
  }
}

// When `unified` runs process(value), it converts `value` to vFile class if `value` does not look like a vFile.
// However, the constructor of vFile calls proc.cwd, which is not provided in vite runtime
// To avoid vFile complaining “proc.cwd is not a function”, we use a fake vFile class that stringifies as usual but
// never calls proc.cwd.
// FUCK JAVASCRIPT
class vFileShim {
  constructor(value) {
    this.value = value
    this.messages = []
    this.message = (reason, place, origin) => {
      const msg = new VFileMessage(reason, place, origin)
      msg.fatal = false
      this.messages.push(msg)
      return msg
    }
  }

  toString() {
    return this.value
  }
}

export function makeMarkdown(content) {
  const metadata = { title: defaultTitle, description: "" }
  const convertedHtml = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(getMetadata, { result: metadata })  // result is written to `metadata` variable
    .use(remarkRehype)
    .use(sanitizeMarkdownUrls)
    .use(rehypeStringify)
    .processSync(new vFileShim(content))

  return `<!DOCTYPE html>
<html lang='en'>
<head>
  <meta charset='utf-8'>
  <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>
  <title>${metadata.title}</title>
  ${metadata.description.length > 0 ? `<meta name='description' content='${metadata.description}'>` : ""}
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/themes/prism.css' rel='stylesheet' />
  <link href='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.css' rel='stylesheet' />
  <link rel='stylesheet' href='https://pages.github.com/assets/css/style.css'>
  <style>${typographyCss}</style>
  <script id="MathJax-script" async
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js">
  </script>
</head>
<body>
<article class='line-numbers container-lg px-3 my-5 markdown-body'>
${convertedHtml}
</article>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/components/prism-core.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/line-numbers/prism-line-numbers.min.js'></script>
  <script src='https://cdn.jsdelivr.net/npm/prismjs@1.23.0/plugins/autoloader/prism-autoloader.min.js'></script>
</html>
`
}
