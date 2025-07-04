[简体中文](#简体中文) | [English](#english)

---
<a name="简体中文"></a>

# 书签备份扩展程序隐私政策

**最后更新日期:** 2025年01月01日

本隐私政策描述了"书签备份"扩展程序（以下简称"本扩展"）如何处理您的信息。我们极度重视您的隐私。本扩展的核心原则是：**您的数据，永远属于您自己**。

## 1. 我们处理的数据

为了实现核心功能，本扩展需要处理以下两种类型的数据：

*   **您的书签数据**: 包括您书签的URL、标题和文件夹结构。这是创建备份文件所必需的。
*   **您的WebDAV服务器凭据**: 如果您选择使用云端备份功能，您需要提供您自己的WebDAV服务器的URL、用户名和密码。

## 2. 您的数据如何被处理

**您的所有数据都永远在您的掌控之中。**

*   **本地处理**: 所有的数据处理，包括读取您的书签和生成备份文件，都在您自己设备上的浏览器内部本地完成。
*   **本地存储**: 您的所有设置和WebDAV凭据都通过 `chrome.storage.local` API 存储在您自己的计算机上。开发者或任何第三方都无法访问这些数据。
*   **云端备份 (WebDAV)**: 当您使用WebDAV备份功能时，本扩展会将您的书签数据**从您的浏览器直接发送到您自己配置的WebDAV服务器**。开发者**无法**访问您的WebDAV服务器、您的凭据，也无法访问正在传输的书签数据。这个连接是由您的浏览器为您建立的。

**我们，"书签备份"扩展程序的开发者，绝不会收集、存储、查看或以任何方式访问您的书签数据或您的WebDAV凭据。**

## 3. 权限说明

本扩展请求的权限都严格用于其声明的核心功能：
*   `bookmarks`: 用于读取您的书签以进行备份。
*   `storage`: 用于在本地保存您的设置。
*   `host_permissions`: 仅用于允许扩展连接到**您自己**提供的WebDAV服务器。

## 4. 政策变更

我们可能会不时更新我们的隐私政策。我们会通过在此页面上发布新的隐私政策来通知您任何更改。

## 5. 联系我们

如果您对本隐私政策有任何疑问，您可以通过在我们的 [GitHub仓库](https://github.com/kwenxu/Bookmark-Backup/issues) 提交一个 issue 来联系我们。

---
<a name="english"></a>

# Privacy Policy for Bookmark Backup

**Last Updated:** 2025-01-01

This Privacy Policy describes how Bookmark Backup ("the Extension") handles your information. Your privacy is critically important to us. The core principle of this extension is that **your data is YOUR data**.

## 1. Data We Handle

The Extension needs to handle two types of user data to perform its core functions:

*   **Your Bookmarks:** This includes the URL, title, and folder structure of your bookmarks. This data is required to create backup files.
*   **Your WebDAV Server Credentials:** If you choose to use the cloud backup feature, you will need to provide the URL, username, and password for your own WebDAV server.

## 2. How Your Data is Handled

**Your data never leaves your control.**

*   **Local Processing:** All data processing, including reading your bookmarks and preparing the backup file, happens locally within your browser on your own device.
*   **Local Storage:** Your settings and WebDAV credentials are stored locally on your computer using the `chrome.storage.local` API. This data is not accessible to the developer or any other third party.
*   **Cloud Backup (WebDAV):** If you use the WebDAV backup feature, the Extension will send your bookmark data **directly from your browser to the WebDAV server you have configured**. The developer **does not** have access to your WebDAV server, your credentials, or the bookmark data being transmitted. The connection is made by your browser, for you.

**We, the developers of Bookmark Backup, do not collect, store, see, or have any access to your bookmarks or your WebDAV credentials.**

## 3. Permissions Justification

The Extension requests certain permissions to function. All permissions are strictly used for the stated core purposes of the extension:
*   `bookmarks`: To read your bookmarks for backup.
*   `storage`: To save your settings locally.
*   `host_permissions`: To allow the extension to connect to the WebDAV server **you** provide.

## 4. Changes to This Privacy Policy

We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.

## 5. Contact Us

If you have any questions about this Privacy Policy, you can contact us by opening an issue on our [GitHub repository](https://github.com/kwenxu/Bookmark-Backup/issues). 