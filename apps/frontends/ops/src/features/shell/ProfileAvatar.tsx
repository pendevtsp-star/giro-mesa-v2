import { Avatar } from "@giromesa/ui";
import type { Profile } from "../../domain";

const acceptedAvatarTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function profileAvatarFileError(file: { size: number; type: string }) {
  if (!acceptedAvatarTypes.has(file.type)) return "Use uma imagem JPG, PNG ou WEBP.";
  if (file.size === 0 || file.size > 1_000_000) return "A foto deve ter no máximo 1 MB.";
  return null;
}

export function profileAvatarStorageKey(identityId: string) {
  return `giromesa_profile_avatar:${identityId}`;
}

export function ProfileAvatar({
  imageUrl,
  profile,
}: {
  imageUrl?: string | null;
  profile: Profile;
}) {
  return (
    <Avatar
      initials={profile.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("")}
      src={imageUrl}
    />
  );
}
