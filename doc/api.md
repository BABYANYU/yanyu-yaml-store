# Yanyu YAML Store API Reference

This document describes the local maintenance contract as of 2026-11-16. These changes have **not been deployed**. Examples use the maintained site, https://fakeyou.eu.org/, but are illustrative: substitute a local or staging URL to test unpublished changes. Example pastes and responses are not production verification evidence. Maintained by BABYANYU; repository: [BABYANYU/yanyu-yaml-store](https://github.com/BABYANYU/yanyu-yaml-store).

KV remains eventually consistent. Name allocation uses get-then-put and is not atomic; concurrent creates or updates can race. Successful requests do not establish immediate global visibility or compare-and-swap guarantees.

## GET `/`

Return the index page.

## **GET** `/<name>[.<ext>]` or `/<name>/<filename>[.<ext>]`

Fetch the paste with name `<name>`. By default, it will return the raw content of the paste.

The `Content-Type` header is set to `text/plain;charset=UTF-8`. If `<ext>` is given, the worker will infer mime-type from `<ext>` and change `Content-Type`. This method accepts the following query string parameters:

The `Content-Disposition` header is set to `inline` by default. But can be overriden by `?a` query string. If the paste is uploaded with filename, or `<filename>` is set in given request URL, `Content-Disposition` is appended with `filename*` indicating the filename (with `<ext>` if it exists).

- `?a=`: optional. Set `Content-Disposition` to `attachment` if present.

- `?lang=<lang>`: optional. Returns a web page with syntax highlight powered by prism.js.

- `?mime=<mime>`: optional. Specify the mime-type, suppressing the effect of `<ext>`. No effect if `lang` is specified (in which case the mime-type is always `text/html`).

Examples: `GET /abcd?lang=js`, `GET /abcd?mime=application/json`.

Raw responses retain MIME/attachment controls and include `Content-Security-Policy: sandbox`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Sandbox restricts active HTML/SVG execution in a browser; it does not change the downloaded raw bytes and does not validate YAML. Paste-rendering responses and redirects also use no-store, as do conditional 304 responses. This does not change KV eventual consistency. Do not assume every HTML rendering path has independent-origin isolation. Admin pages use private/no-store and no-referrer; the management URL remains sensitive.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl https://fakeyou.eu.org/i-p-
https://web.archive.org/web/20210328091143/https://mp.weixin.qq.com/s/5phCQP7i-JpSvzPEMGk56Q

$ curl https://fakeyou.eu.org/~panty.jpg | feh -

$ firefox 'https://fakeyou.eu.org/kf7z?lang=nix'

$ curl 'https://fakeyou.eu.org/~panty.jpg?mime=image/png' -w '%{content_type}' -o /dev/null -sS
image/png;charset=UTF-8
```

## GET `/<name>:<passwd>`

Return the web page to edit the paste of name `<name>` and password `<passwd>`.

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

## GET `/u/<name>`

Redirect to the URL recorded in the paste of name `<name>`.

If error occurs, the worker returns status code different from `302`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ firefox https://fakeyou.eu.org/u/i-p-

$ curl -L https://fakeyou.eu.org/u/i-p-
```

## GET `/a/<name>`

Return the HTML converted from the markdown file stored in the paste of name `<name>`. The markdown conversion follows GitHub Flavored Markdown (GFM) Spec, supported by [remark-gfm](https://github.com/remarkjs/remark-gfm).

Syntax highlighting is supported by [prims.js](https://prismjs.com/). LaTeX mathematics is supported by [MathJax](https://www.mathjax.org).

If error occurs, the worker returns status code different from `200`:

- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```md
# Header 1
This is the content of `test.md`

<script>
alert("Script should be removed")
</script>

## Header 2

| abc | defghi |
:-: | -----------:
bar | baz

**Bold**, `Monospace`, *Italics*, ~~Strikethrough~~, [URL](https://github.com)

- A
 - A1
 - A2
- B

![Panty](https://fakeyou.eu.org/~panty.jpg)

1. first
2. second

> Quotation

$$
\int_{-\infty}^{\infty} e^{-x^2} = \sqrt{\pi}
$$

```

```shell
$ curl -Fc=@test.md -Fn=test-md https://fakeyou.eu.org

$ firefox https://fakeyou.eu.org/a/~test-md
```

## **POST** `/`

Upload your paste. It accept parameters in form-data:

- `c`: mandatory. Text or binary content, at most **25 MiB (26,214,400 bytes)**. The complete multipart request body, including boundaries and other fields, must not exceed **26 MiB (27,262,976 bytes)**. The uploaded filename is retained for retrieval.

- `e`: optional. Expiration duration, converted to a **finite safe integer number of seconds**, at least 60. Bare seconds must be integers. Units: `s`, `m`, `h`, `d`, `w`, `M` (30 days), `Y` (365 days). Fractional quantities with units are accepted only when the resulting seconds are integral: `1.5h` = 5400 seconds; bare `360.24`, `1.5s`, negative values, Infinity and unsafe integers return 400. The computed absolute expiration must also be a safe integer. Omitted or empty `e` on POST creates a paste without expiration.

- `s`: optional. Password for modifying/deleting a paste. Omitted or empty `s` on POST generates a random password. An explicit password is at most 128 bytes and must match `/^[A-Za-z0-9_~!$&'()*+,;=@-]+$/`; `.`, `:`, `/`, `?`, `#`, whitespace and other characters are not accepted. Oversized fields return 413; invalid nonempty passwords return 400.

- `n`: optional. Customized name, at least 3 ASCII characters and at most **511 bytes**, matching `/^[a-zA-Z0-9+_\-\[\]*$@,;]{3,}$/`. Slash, equals sign, dot, colon and spaces are not accepted. Retrieval prefixes the name with `~` (the stored key is at most 512 bytes). If omitted, a random name is generated (4 characters by default). Existing names return 409, but concurrent requests remain subject to the non-atomic get-then-put race.

- `p`: optional. If present, generates a 24-character random name; it does not alter a custom `n`. This is only a longer unguessable-name mode, **not an ACL, authentication or encryption**. Anyone who knows the read URL can read the paste.

`POST` method returns a JSON string by default, if no error occurs, for example:

```json
{
    "url": "https://fakeyou.eu.org/abcd",
    "admin": "https://fakeyou.eu.org/abcd:w2eHqyZGc@CQzWLN=BiJiQxZ",
    "expire": 100,
    "isPrivate": false
}
```

Explanation of the fields:

- `url`: String. The URL to fetch the paste. When using a customized name, it looks like `https://fakeyou.eu.org/~myname`.
- `suggestUrl`: String or null. The URL that may carry filename or URL redirection.
- `admin`: String. The URL to update and delete the paste: `url` suffixed by **`:`** and the password. Treat this URL as a bearer credential; never share it as the read link.
- `expire`: Number or null. Remaining expiration seconds at the response time; null means no expiration. After PUT without `e`, this is the remaining lifetime, not the original duration.
- `isPrivate`: Bool. Whether the paste is in private mode.

If error occurs, the worker returns status code different from `200`:

- `400`: your request is in bad format.
- `409`: the name is already used.
- `413`: the content is too large.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl -Fc="kawaii" -Fe=300 -Fn=hitagi https://fakeyou.eu.org  # uploading some text
{
  "url": "https://fakeyou.eu.org/~hitagi",
  "admin": "https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "isPrivate": false,
  "expire": 300
}

$ curl -Fc=@panty.jpg -Fn=panty -Fs=12345678 https://fakeyou.eu.org   # uploading a file
{
  "url": "https://fakeyou.eu.org/~panty",
  "admin": "https://fakeyou.eu.org/~panty:12345678",
  "isPrivate": false
}

# because `curl` takes some characters as filed separator, the fields should be
# quoted by double-quotes if the field contains semicolon or comma
$ curl -Fc=@panty.jpg -Fn='"hi_hello;g,ood"' -Fs=12345678 https://fakeyou.eu.org
{
  "url": "https://fakeyou.eu.org/~hi_hello;g,ood",
  "admin": "https://fakeyou.eu.org/~hi_hello;g,ood:12345678",
  "isPrivate": false
}
```

## **PUT** `/<name>:<passwd>`

Update you paste of the name `<name>` and password `<passwd>`. It accept the parameters in form-data:

- `c`: mandatory. Same as `POST` method.
- `e`: optional. A nonempty value follows POST validation and computes a new absolute expiration from the update time. **Omitted or empty `e` preserves the existing absolute expiration**, including no-expiration entries; it does not reset the remaining TTL or make an expiring paste permanent. If the preserved expiry is less than 60 seconds away, the update returns 400. If a legacy entry's expiration cannot be determined, the update returns 503 instead of guessing.
- `s`: optional. A nonempty value changes the password under the POST character/size rules. **Omitted or empty `s` preserves the current password**. The password in the request URL must still match the existing metadata before writing.

The returning of `PUT` method is the same as `POST` method.

If error occurs, the worker returns status code different from `200`:

- `400`: your request is in bad format.
- `403`: your password is not correct.
- `404`: the paste of given name is not found.
- `413`: the content, total request body, or a bounded field is too large.
- `503`: the existing expiration cannot be confirmed; no guessed expiration is written.
- `500`: unexpected exception. You may report this to the maintainer.

Usage example:

```shell
$ curl -X PUT -Fc="kawaii~" -Fe=500 https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv
{
  "url": "https://fakeyou.eu.org/~hitagi",
  "admin": "https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "isPrivate": false,
  "expire": 500
}

$ curl -X PUT -Fc="kawaii~" https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv
{
  "url": "https://fakeyou.eu.org/~hitagi",
  "admin": "https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv",
  "isPrivate": false
}
```

## DELETE `/<name>:<passwd>`

Delete the paste of name `<name>` and password `<passwd>`. It may take seconds to synchronize the deletion globally.

If error occurs, the worker returns status code different from `200`:

- `403`: your password is not correct.
- `404`: the paste of given name is not found.
- `500`: unexpected exception. You may report this to the author to give it a fix.

Usage example:

```shell
$ curl -X DELETE https://fakeyou.eu.org/~hitagi:22@-OJWcTOH2jprTJWYadmDv
the paste will be deleted in seconds

$ curl https://fakeyou.eu.org/~hitagi
not found
```
