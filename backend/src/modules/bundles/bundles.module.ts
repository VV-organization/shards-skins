import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../common/database/database.module";
import { CatalogModule } from "../catalog/catalog.module";
import { BundlesService } from "./bundles.service";
@Module({ imports: [DatabaseModule, CatalogModule], controllers: [], providers: [BundlesService], exports: [BundlesService] })
export class BundlesModule {}
