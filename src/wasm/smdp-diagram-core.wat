(module
  ;; Dependency-free Mermaid source scanner. The host copies one fenced block
  ;; into this memory, then drains fixed-width line records. Newline discovery
  ;; is SIMD accelerated; token hashing and delimiter flags stay scalar because
  ;; they are branch-heavy and operate on one logical line at a time.
  (memory (export "memory") 2 1024)

  ;; Result header (all little-endian u32):
  ;;   status, count, cursor, error, abiVersion
  ;; Line record (24 bytes):
  ;;   start, end, indentation, flags, firstTokenHash, reserved
  ;;
  ;; Flags:
  ;;   bit 0 empty, bit 1 Mermaid comment, bit 2 arrow punctuation,
  ;;   bit 3 colon, bit 4 comma, bit 5 bracket, bit 6 quote.

  (func (export "diagram_abi_version") (result i32)
    i32.const 1)

  (func (export "diagram_uses_simd") (result i32)
    i32.const 1)

  (func $write_result
    (param $result i32) (param $status i32) (param $count i32)
    (param $cursor i32) (param $error i32)
    local.get $result
    local.get $status
    i32.store
    local.get $result
    local.get $count
    i32.store offset=4
    local.get $result
    local.get $cursor
    i32.store offset=8
    local.get $result
    local.get $error
    i32.store offset=12
    local.get $result
    i32.const 1
    i32.store offset=16)

  (func $find_eol
    (param $src i32) (param $pos i32) (param $end i32) (result i32)
    (local $v v128) (local $mask i32)
    (block $vector_done
      (loop $vector
        local.get $pos
        i32.const 16
        i32.add
        local.get $end
        i32.gt_u
        br_if $vector_done

        local.get $src
        local.get $pos
        i32.add
        v128.load
        local.tee $v
        i32.const 10
        i8x16.splat
        i8x16.eq
        local.get $v
        i32.const 13
        i8x16.splat
        i8x16.eq
        v128.or
        i8x16.bitmask
        local.tee $mask
        if
          local.get $pos
          local.get $mask
          i32.ctz
          i32.add
          return
        end

        local.get $pos
        i32.const 16
        i32.add
        local.set $pos
        br $vector))

    (block $tail_done
      (loop $tail
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $tail_done
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        i32.const 10
        i32.eq
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        i32.const 13
        i32.eq
        i32.or
        if
          local.get $pos
          return
        end
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $tail))
    local.get $end)

  (func $is_inline_ws (param $c i32) (result i32)
    local.get $c
    i32.const 32
    i32.eq
    local.get $c
    i32.const 9
    i32.eq
    i32.or)

  (func $lower_ascii (param $c i32) (result i32)
    local.get $c
    i32.const 65
    i32.ge_u
    local.get $c
    i32.const 90
    i32.le_u
    i32.and
    if (result i32)
      local.get $c
      i32.const 32
      i32.or
    else
      local.get $c
    end)

  (func $hash_first_token
    (param $src i32) (param $start i32) (param $end i32) (result i32)
    (local $pos i32) (local $hash i32) (local $c i32)
    local.get $start
    local.set $pos
    i32.const -2128831035
    local.set $hash
    (block $done
      (loop $scan
        local.get $pos
        local.get $end
        i32.ge_u
        br_if $done
        local.get $src
        local.get $pos
        i32.add
        i32.load8_u
        local.tee $c
        call $is_inline_ws
        local.get $c
        i32.const 58
        i32.eq
        i32.or
        br_if $done
        local.get $hash
        local.get $c
        call $lower_ascii
        i32.xor
        i32.const 16777619
        i32.mul
        local.set $hash
        local.get $pos
        i32.const 1
        i32.add
        local.set $pos
        br $scan))
    local.get $hash)

  (func $write_line
    (param $out i32) (param $index i32)
    (param $start i32) (param $end i32) (param $indent i32)
    (param $flags i32) (param $hash i32)
    (local $record i32)
    local.get $out
    local.get $index
    i32.const 24
    i32.mul
    i32.add
    local.tee $record
    local.get $start
    i32.store
    local.get $record
    local.get $end
    i32.store offset=4
    local.get $record
    local.get $indent
    i32.store offset=8
    local.get $record
    local.get $flags
    i32.store offset=12
    local.get $record
    local.get $hash
    i32.store offset=16
    local.get $record
    i32.const 0
    i32.store offset=20)

  (func (export "diagram_scan_lines")
    (param $src i32) (param $length i32) (param $cursor i32)
    (param $out i32) (param $capacity i32) (param $result i32)
    (result i32)
    (local $count i32) (local $line_start i32) (local $line_end i32)
    (local $trim i32) (local $indent i32) (local $flags i32)
    (local $hash i32) (local $pos i32) (local $c i32)

    local.get $capacity
    i32.eqz
    if
      local.get $result
      i32.const 2
      i32.const 0
      local.get $cursor
      i32.const 1
      call $write_result
      i32.const 2
      return
    end

    local.get $cursor
    local.get $length
    i32.gt_u
    if
      local.get $result
      i32.const 2
      i32.const 0
      local.get $cursor
      i32.const 2
      call $write_result
      i32.const 2
      return
    end

    (block $done
      (loop $lines
        local.get $cursor
        local.get $length
        i32.ge_u
        br_if $done
        local.get $count
        local.get $capacity
        i32.ge_u
        br_if $done

        local.get $cursor
        local.set $line_start
        local.get $src
        local.get $cursor
        local.get $length
        call $find_eol
        local.set $line_end

        local.get $line_start
        local.set $trim
        i32.const 0
        local.set $indent
        (block $trim_done
          (loop $trim_loop
            local.get $trim
            local.get $line_end
            i32.ge_u
            br_if $trim_done
            local.get $src
            local.get $trim
            i32.add
            i32.load8_u
            local.tee $c
            call $is_inline_ws
            i32.eqz
            br_if $trim_done
            local.get $indent
            local.get $c
            i32.const 9
            i32.eq
            if (result i32)
              i32.const 2
            else
              i32.const 1
            end
            i32.add
            local.set $indent
            local.get $trim
            i32.const 1
            i32.add
            local.set $trim
            br $trim_loop))

        i32.const 0
        local.set $flags
        i32.const 0
        local.set $hash
        local.get $trim
        local.get $line_end
        i32.ge_u
        if
          i32.const 1
          local.set $flags
        else
          local.get $trim
          i32.const 1
          i32.add
          local.get $line_end
          i32.lt_u
          if
            local.get $src
            local.get $trim
            i32.add
            i32.load8_u
            i32.const 37
            i32.eq
            local.get $src
            local.get $trim
            i32.add
            i32.load8_u offset=1
            i32.const 37
            i32.eq
            i32.and
            if
              local.get $flags
              i32.const 2
              i32.or
              local.set $flags
            end
          end
          local.get $src
          local.get $trim
          local.get $line_end
          call $hash_first_token
          local.set $hash
        end

        local.get $trim
        local.set $pos
        (block $flags_done
          (loop $flags_loop
            local.get $pos
            local.get $line_end
            i32.ge_u
            br_if $flags_done
            local.get $src
            local.get $pos
            i32.add
            i32.load8_u
            local.set $c
            local.get $c
            i32.const 45
            i32.eq
            local.get $c
            i32.const 61
            i32.eq
            i32.or
            local.get $c
            i32.const 60
            i32.eq
            i32.or
            local.get $c
            i32.const 62
            i32.eq
            i32.or
            if
              local.get $flags
              i32.const 4
              i32.or
              local.set $flags
            end
            local.get $c
            i32.const 58
            i32.eq
            if
              local.get $flags
              i32.const 8
              i32.or
              local.set $flags
            end
            local.get $c
            i32.const 44
            i32.eq
            if
              local.get $flags
              i32.const 16
              i32.or
              local.set $flags
            end
            local.get $c
            i32.const 40
            i32.eq
            local.get $c
            i32.const 41
            i32.eq
            i32.or
            local.get $c
            i32.const 91
            i32.eq
            i32.or
            local.get $c
            i32.const 93
            i32.eq
            i32.or
            local.get $c
            i32.const 123
            i32.eq
            i32.or
            local.get $c
            i32.const 125
            i32.eq
            i32.or
            if
              local.get $flags
              i32.const 32
              i32.or
              local.set $flags
            end
            local.get $c
            i32.const 34
            i32.eq
            local.get $c
            i32.const 39
            i32.eq
            i32.or
            if
              local.get $flags
              i32.const 64
              i32.or
              local.set $flags
            end
            local.get $pos
            i32.const 1
            i32.add
            local.set $pos
            br $flags_loop))

        local.get $out
        local.get $count
        local.get $line_start
        local.get $line_end
        local.get $indent
        local.get $flags
        local.get $hash
        call $write_line
        local.get $count
        i32.const 1
        i32.add
        local.set $count

        local.get $line_end
        local.set $cursor
        local.get $cursor
        local.get $length
        i32.lt_u
        if
          local.get $src
          local.get $cursor
          i32.add
          i32.load8_u
          i32.const 13
          i32.eq
          local.get $cursor
          i32.const 1
          i32.add
          local.get $length
          i32.lt_u
          i32.and
          if
            local.get $src
            local.get $cursor
            i32.add
            i32.load8_u offset=1
            i32.const 10
            i32.eq
            if
              local.get $cursor
              i32.const 2
              i32.add
              local.set $cursor
            else
              local.get $cursor
              i32.const 1
              i32.add
              local.set $cursor
            end
          else
            local.get $cursor
            i32.const 1
            i32.add
            local.set $cursor
          end
        end
        br $lines))

    local.get $result
    local.get $cursor
    local.get $length
    i32.lt_u
    if (result i32)
      i32.const 1
    else
      i32.const 0
    end
    local.get $count
    local.get $cursor
    i32.const 0
    call $write_result
    local.get $cursor
    local.get $length
    i32.lt_u
    if (result i32)
      i32.const 1
    else
      i32.const 0
    end)
)
