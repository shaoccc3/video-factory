import { CustomerServiceOutlined, FileOutlined, FontSizeOutlined } from "@ant-design/icons";
import { Flex } from "antd";
import type { CSSProperties } from "react";
import { assetThumbnailUrl } from "../api/client";
import type { Asset } from "../api/types";

const box: CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  background: "#f5f5f5",
  objectFit: "cover",
  display: "block",
};

function isVisual(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/");
}

/** 素材縮圖：圖片／影片用縮圖，其餘顯示圖示 */
export function AssetThumb({ asset, height }: { asset: Asset; height?: number }) {
  const style: CSSProperties = height ? { ...box, aspectRatio: "auto", height } : box;
  if (isVisual(asset.mime)) {
    const src = asset.thumbnail_url ?? (asset.mime.startsWith("image/") ? asset.content_url : null);
    if (src) return <img src={src} alt={asset.display_name} style={style} loading="lazy" />;
  }
  const icon = asset.mime.startsWith("audio/") ? (
    <CustomerServiceOutlined />
  ) : asset.kind === "font" ? (
    <FontSizeOutlined />
  ) : (
    <FileOutlined />
  );
  return (
    <Flex justify="center" align="center" style={{ ...style, fontSize: 32, color: "#999" }}>
      {icon}
    </Flex>
  );
}

/** 只有 ID 時的縮圖（例如任務的首幀、封面） */
export function AssetIdThumb({ id, size = 64, alt }: { id: string; size?: number; alt: string }) {
  return (
    <img
      src={assetThumbnailUrl(id)}
      alt={alt}
      width={size}
      height={size}
      style={{ objectFit: "cover", background: "#f5f5f5", borderRadius: 4 }}
    />
  );
}
