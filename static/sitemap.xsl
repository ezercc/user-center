<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0" 
    xmlns:html="http://www.w3.org/TR/REC-html40"
    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
    xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
    xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <title>XML Sitemap</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <style type="text/css">
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 40px; background-color: #f9f9f9; }
          #sitemap { max-width: 960px; margin: 0 auto; background: #fff; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 8px; }
          h1 { font-size: 24px; color: #111; margin-bottom: 20px; }
          p { margin-bottom: 20px; color: #666; }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
          th { background-color: #f4f4f4; color: #333; font-weight: 600; font-size: 12px; text-transform: uppercase; }
          tr:hover td { background-color: #fafafa; }
          a { color: #0066cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .meta { font-size: 12px; color: #888; }
        </style>
      </head>
      <body>
        <div id="sitemap">
          <h1>XML Sitemap</h1>
          <p>This is an XML Sitemap, meant for consumption by search engines. This page is styled with XSLT for human readability.</p>
          <xsl:if test="count(sitemap:sitemapindex/sitemap:sitemap) &gt; 0">
            <table>
              <thead>
                <tr>
                  <th>Sitemap URL</th>
                  <th>Last Modified</th>
                </tr>
              </thead>
              <tbody>
                <xsl:for-each select="sitemap:sitemapindex/sitemap:sitemap">
                  <tr>
                    <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
                    <td class="meta"><xsl:value-of select="sitemap:lastmod"/></td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </xsl:if>
          <xsl:if test="count(sitemap:sitemapindex/sitemap:sitemap) = 0">
            <table>
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Change Frequency</th>
                  <th>Priority</th>
                  <th>Last Modified</th>
                </tr>
              </thead>
              <tbody>
                <xsl:for-each select="sitemap:urlset/sitemap:url">
                  <tr>
                    <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
                    <td class="meta"><xsl:value-of select="sitemap:changefreq"/></td>
                    <td class="meta"><xsl:value-of select="sitemap:priority"/></td>
                    <td class="meta"><xsl:value-of select="sitemap:lastmod"/></td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </xsl:if>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
