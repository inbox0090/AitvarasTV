# XUI One integration notes

The requested plan model uses the terminology commonly exposed by XUI-style panels: playlist/bouquet categories, account/package type, duration or expiry, and maximum simultaneous connections. This project stores those values as an admin-managed plan catalogue and does not invent provider credentials or call an XUI endpoint. Automatic line creation, renewal, suspension, and payment provisioning require a separately configured XUI API contract and credentials, so existing IPTV routes remain unchanged.

Sources consulted for terminology:

- [XUI One vs Xtream UI comparison](https://iptvbp.com/blog/xui-one-vs-xtream-ui-comparison)
- [Add Bouquet, Category, and Live Stream in XUI.ONE](https://iptvtools.io/iptv-docs/add-bouquet-category-and-live-stream-in-xui-one/)
- [How to Create a Line in XUI One](https://iptv-help.net/docs/xui-one-tutorials/resellers/how-to-create-line/)

These sources were used only to align field labels; they are not treated as an implementation API contract.
