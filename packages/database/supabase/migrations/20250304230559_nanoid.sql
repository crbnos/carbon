/*
 * Copyright 2023 [Your Name or Your Organization's Name]
 *
 * Modifications made to the original software:
 * - Added support for a prefix in the nanoid() function.
 *
 * The original software is provided under the Apache License, Version 2.0:
 * =========================================================================
 * Copyright 2023 Viascom Ltd liab. Co
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 * =========================================================================
 *
 * This modified version is also distributed under the Apache License, Version 2.0.
 */
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP FUNCTION IF EXISTS nanoid(int, text, float, text);

CREATE OR REPLACE FUNCTION nanoid(prefix text DEFAULT '', size int DEFAULT 21, alphabet text DEFAULT '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', additionalBytesFactor float DEFAULT 1.02)
    RETURNS text
    LANGUAGE plpgsql
    VOLATILE PARALLEL SAFE
    AS $$
DECLARE
    alphabetArray text[];
    alphabetLength int := 64;
    mask int := 63;
    step int := 34;
    finalId text;
    adjustedSize int;
    -- Variable for the adjusted size excluding the prefix length
BEGIN
    IF size IS NULL OR size < 1 THEN
        RAISE EXCEPTION 'The size must be defined and greater than 0!';
    END IF;
    IF alphabet IS NULL OR length(alphabet) = 0 OR length(alphabet) > 255 THEN
        RAISE EXCEPTION 'The alphabet can''t be undefined, zero or bigger than 255 symbols!';
    END IF;
    IF additionalBytesFactor IS NULL OR additionalBytesFactor < 1 THEN
        RAISE EXCEPTION 'The additional bytes factor can''t be less than 1!';
    END IF;
    -- Adjust the size to exclude the prefix length
    adjustedSize := size - length(prefix);
    IF adjustedSize < 1 THEN
        RAISE EXCEPTION 'The size including the prefix must be greater than 0!';
    END IF;
    alphabetArray := regexp_split_to_array(alphabet, '');
    alphabetLength := array_length(alphabetArray, 1);
    mask :=(2 << cast(floor(log(alphabetLength - 1) / log(2)) AS int)) - 1;
    step := cast(ceil(additionalBytesFactor * mask * adjustedSize / alphabetLength) AS int);
    IF step > 1024 THEN
        step := 1024;
    END IF;
    finalId := prefix || nanoid_optimized(adjustedSize, alphabet, mask, step);
    RETURN finalId;
END
$$;

DROP FUNCTION IF EXISTS nanoid_optimized(int, text, int, int);

CREATE OR REPLACE FUNCTION nanoid_optimized(size int, alphabet text, mask int, step int)
    RETURNS text
    LANGUAGE plpgsql
    VOLATILE PARALLEL SAFE
    AS $$
DECLARE
    idBuilder text := '';
    counter int := 0;
    bytes bytea;
    alphabetIndex int;
    alphabetArray text[];
    alphabetLength int := 64;
BEGIN
    alphabetArray := regexp_split_to_array(alphabet, '');
    alphabetLength := array_length(alphabetArray, 1);
    LOOP
        bytes := gen_random_bytes(step);
        FOR counter IN 0..step - 1 LOOP
            alphabetIndex :=(get_byte(bytes, counter) & mask) + 1;
            IF alphabetIndex <= alphabetLength THEN
                idBuilder := idBuilder || alphabetArray[alphabetIndex];
                IF length(idBuilder) = size THEN
                    RETURN idBuilder;
                END IF;
            END IF;
        END LOOP;
    END LOOP;
END
$$;
