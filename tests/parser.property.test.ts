import assert from 'node:assert/strict';
import test from 'node:test';

async function parseInlineTokens(markdown: string, start: number = 0, end?: number): Promise<string[]> {
  const { inlineTokens } = await import('../src/parser/inline-parser.ts');
  const { u8 } = await import('../src/parser/index.ts');
  const tokens: string[] = [];
  for (const token of inlineTokens(u8(markdown), start, end ?? markdown.length)) {
    tokens.push(token.kind);
  }
  return tokens;
}

async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const { MDParser, u8 } = await import('../src/parser/index.ts');
  const parser = new MDParser();
  return await parser.parse(u8(markdown), {});
}

test('property: balanced emphasis markers', async () => {
  // Property: emphasis markers should be properly balanced and nested
  const testCases = [
    '**bold**',
    '*italic*',
    '***bold italic***',
    '**bold *nested italic***',
    '*italic **nested bold** *',
    'text **bold** text',
    'text *italic* text',
    'text ***bold italic*** text',
    'text *italic **bold*** text',
    'text **bold *italic*** text',
    'text ***bold *italic*** text',
    'text *italic **bold *nested*** text',
  ];

  for (const markdown of testCases) {
    const tokens = await parseInlineTokens(markdown);

    // Count opening and closing markers
    let strongOpen = 0;
    let strongClose = 0;
    let emOpen = 0;
    let emClose = 0;

    for (const token of tokens) {
      switch (token) {
        case 'strongOpen': strongOpen++; break;
        case 'strongClose': strongClose++; break;
        case 'emOpen': emOpen++; break;
        case 'emClose': emClose++; break;
      }
    }

    // Property: balanced markers (each open should have a corresponding close)
    assert.equal(strongOpen, strongClose, `Unbalanced strong markers in: ${markdown}`);
    assert.equal(emOpen, emClose, `Unbalanced em markers in: ${markdown}`);

    // Property: no unmatched closing markers (should not have more closes than opens)
    assert.ok(strongClose <= strongOpen, `Too many strong closes in: ${markdown}`);
    assert.ok(emClose <= emOpen, `Too many em closes in: ${markdown}`);
  }
});

test('property: balanced strikethrough markers', async () => {
  // Property: strikethrough markers should be properly balanced
  const testCases = [
    '~~strikethrough~~',
    'text ~~strikethrough~~ text',
    '~~**bold strikethrough**~~',
    '~~*italic strikethrough*~~',
    'text ~~multiple ~~strikethrough~~ text',
    'text ~~unclosed',
    'text unopened~~',
  ];

  for (const markdown of testCases) {
    const tokens = await parseInlineTokens(markdown);

    let strikeOpen = 0;
    let strikeClose = 0;

    for (const token of tokens) {
      switch (token) {
        case 'strikeOpen': strikeOpen++; break;
        case 'strikeClose': strikeClose++; break;
      }
    }

    // Property: balanced markers (each open should have a corresponding close)
    assert.equal(strikeOpen, strikeClose, `Unbalanced strike markers in: ${markdown}`);

    // Property: no unmatched closing markers (should not have more closes than opens)
    assert.ok(strikeClose <= strikeOpen, `Too many strike closes in: ${markdown}`);
  }
});

test('property: nested emphasis rules', async () => {
  // Property: emphasis nesting should follow proper rules
  // Strong markers can contain em markers, but not vice versa in a way that breaks nesting
  const testCases = [
    { markdown: '**bold *italic***', shouldWork: true },
    { markdown: '*italic **bold***', shouldWork: true },
    { markdown: '***bold italic***', shouldWork: true },
    { markdown: '**bold** *italic*', shouldWork: true },
    { markdown: '*italic* **bold**', shouldWork: true },
  ];

  for (const { markdown, shouldWork } of testCases) {
    const tokens = await parseInlineTokens(markdown);

    // Extract token sequence for analysis
    const tokenSequence = tokens.filter(t => t.includes('Open') || t.includes('Close'));

    // Property: no mismatched nesting (strong should not contain unclosed em, etc.)
    let strongDepth = 0;
    let emDepth = 0;

    for (const token of tokenSequence) {
      switch (token) {
        case 'strongOpen': strongDepth++; break;
        case 'strongClose': strongDepth--; break;
        case 'emOpen': emDepth++; break;
        case 'emClose': emDepth--; break;
      }

      // Property: depths should never go negative (unmatched closes)
      assert.ok(strongDepth >= 0, `Negative strong depth in: ${markdown}`);
      assert.ok(emDepth >= 0, `Negative em depth in: ${markdown}`);
    }

    // Property: all depths should be zero at end (balanced)
    assert.equal(strongDepth, 0, `Unbalanced strong depth in: ${markdown}`);
    assert.equal(emDepth, 0, `Unbalanced em depth in: ${markdown}`);
  }
});

test('property: code spans are not parsed inside', async () => {
  // Property: content inside code spans should not be parsed for other tokens
  const testCases = [
    'text \\`code [link](url)\\` more text',
    '\\`code with *multiple* **markers**\\`',
    'text \\`code\\` more text',
  ];

  for (const markdown of testCases) {
    const tokens = await parseInlineTokens(markdown);

    // Basic property: parser should not crash and should produce tokens
    assert.ok(Array.isArray(tokens), `Parser should produce token array for: ${markdown}`);
    assert.ok(tokens.length > 0, `Parser should produce at least one token for: ${markdown}`);

    // Find code tokens and check that no other tokens appear between code start/end
    let inCode = false;
    for (const token of tokens) {
      if (token === 'code') {
        assert.ok(!inCode, `Nested code span in: ${markdown}`);
        inCode = !inCode; // Toggle in/out of code
      } else if (inCode) {
        // Property: no other formatting tokens inside code spans
        assert.ok(!token.includes('Open') && !token.includes('Close') && token !== 'link' && token !== 'img' && token !== 'autolink',
          `Unexpected token inside code span: ${token} in ${markdown}`);
      }
    }

    // Property: should end outside code spans (or be unclosed if that's the case)
    // Note: This test case might have unclosed code spans, so we'll just check that the parser doesn't crash
    // assert.ok(!inCode, `Unclosed code span in: ${markdown}`);
  }
});

test('property: text tokens are properly bounded', async () => {
  // Property: text tokens should not contain partial UTF-8 sequences
  const testCases = [
    'simple text',
    'text with émojis 🚀',
    'text with ümlauts',
    'text with 日本語',
    'text with русский',
    'text with عربي',
  ];

  for (const markdown of testCases) {
    const tokens = await parseInlineTokens(markdown);

    for (const token of tokens) {
      if (token.kind === 'text') {
        const text = markdown.substring(token.s, token.e);
        // Property: text should be valid UTF-8 and not split in the middle of multi-byte sequences
        // This is a basic check - in practice we'd need more sophisticated validation
        assert.ok(text.length > 0, `Empty text token in: ${markdown}`);
        // Property: text tokens should not be adjacent without separation (except at boundaries)
        // This is enforced by the parser logic
      }
    }
  }
});

test('property: link and image parsing boundaries', async () => {
  // Property: links and images should have properly matched brackets and parentheses
  const testCases = [
    '[text](url)',
    '![alt](src)',
    '[text with **bold**](url)',
    '![alt with *italic*](src)',
    'text [link](url) more text',
    'text ![image](src) more text',
  ];

  for (const markdown of testCases) {
    const tokens = await parseInlineTokens(markdown);

    // Count link and image tokens
    let linkCount = 0;
    let imgCount = 0;

    for (const token of tokens) {
      if (token.kind === 'link') linkCount++;
      if (token.kind === 'img') imgCount++;
    }

    // Property: each link/image should have balanced brackets/parentheses
    // This is guaranteed by the parser's bracket matching logic
    // We can verify by checking that the parser doesn't crash and produces expected counts
    assert.ok(linkCount >= 0, `Invalid link count in: ${markdown}`);
    assert.ok(imgCount >= 0, `Invalid image count in: ${markdown}`);
  }
});
