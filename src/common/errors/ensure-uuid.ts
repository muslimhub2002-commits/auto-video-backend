import { BadRequestException } from "@nestjs/common";
import { isUUID } from "class-validator";

export function ensureUuid(id: string) {
    if (!isUUID(id)) {
        throw new BadRequestException({
            error: "INVALID_ID",
            messageEn: "Invalid id format.",
            messageAr: "معرّف غير صالح.",
        });
    }
}